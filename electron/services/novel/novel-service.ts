import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { loadLibraryState, saveLibraryState } from '../storage/library-store.ts'
import type { DownloadSettingsInput, DownloadSettingsSnapshot, NovelMetadata, NovelTask, NovelTaskAction } from '../../../shared/types/novel.ts'
import { chapterOrdinal } from '../../../shared/lib/catalog-integrity.ts'
import { gutenbergAdapter } from './adapters/gutenberg.ts'
import { jpxs123Adapter } from './adapters/jpxs123.ts'
import type { NovelAdapter } from './adapters/types.ts'
import { extractImportedNovelChapter, getRegisteredNovelAdapter } from './ai-adapter-service.ts'
import { assertCatalogHasChapters, inspectNovelCatalog } from './catalog-integrity.ts'
import { dedupeNovelChapters, normalizeChapterOrder } from './catalog-extraction.ts'
import { removeOwnedNovelArtifacts, resolveOwnedNovelPaths, safeNovelName } from './task-paths.ts'
import { NovelDownloadError, SiteRequestScheduler, classifyDownloadFailure, effectiveSiteConfig, isChapterEligible, normalizeSiteHost, readPersistedDownloadSettings, recoverNovelTaskAfterRestart, retryDelayMs, validateConfig, writePersistedDownloadSettings, type PersistedDownloadSettings } from './download-scheduler.ts'

const adapters: NovelAdapter[] = [gutenbergAdapter, jpxs123Adapter]
const taskLoops = new Map<string, Promise<void>>()
const controls = new Map<string, { paused: boolean; cancelled: boolean; retryOnly: boolean }>()
const deletingTasks = new Set<string>()
const taskOperations = new Map<string, Promise<void>>()
const MAX_WORKERS = 10
const requestScheduler = new SiteRequestScheduler()
let initialized = false
let initialization: Promise<void> | null = null
let mutationQueue: Promise<unknown> = Promise.resolve()
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const taskRoot = () => path.join(app.getPath('userData'), 'novel-downloads')
const taskFile = () => path.join(taskRoot(), 'tasks.json')
const settingsFile = () => path.join(taskRoot(), 'download-settings.json')

async function loadTasks(): Promise<NovelTask[]> {
  let raw: string
  try { raw = await readFile(taskFile(), 'utf-8') }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  return JSON.parse(raw) as NovelTask[]
}

async function initialize(): Promise<void> {
  if (initialized) return
  initialization ??= (async () => {
    const tasks = await loadTasks()
    const recovered = tasks.map(recoverNovelTaskAfterRestart)
    await saveTasks(recovered)
    initialized = true
  })()
  await initialization
}

async function saveTasks(tasks: NovelTask[]): Promise<void> {
  await mkdir(taskRoot(), { recursive: true })
  const temporary = `${taskFile()}.tmp`
  await writeFile(temporary, JSON.stringify(tasks, null, 2), 'utf-8')
  await rename(temporary, taskFile())
}

const loadDownloadSettings=()=>readPersistedDownloadSettings(settingsFile())
const saveDownloadSettingsFile=(settings:PersistedDownloadSettings)=>writePersistedDownloadSettings(settingsFile(),settings)

function downloadSettingsSnapshot(settings:PersistedDownloadSettings,host?:string):DownloadSettingsSnapshot{
  if(!host)return {global:{...settings.global},site:null}
  const effective=effectiveSiteConfig(settings,host),state=settings.siteStates[effective.host]
  return {global:{...settings.global},site:{...effective,pausedReason:state?.pausedReason??null,blockedUntil:state?.blockedUntil&&state.blockedUntil>Date.now()?state.blockedUntil:0}}
}

export async function getNovelDownloadSettings(host?:string):Promise<DownloadSettingsSnapshot>{
  const settings=await loadDownloadSettings();return downloadSettingsSnapshot(settings,host?.trim()?host:undefined)
}

export async function saveNovelDownloadSettings(input:DownloadSettingsInput):Promise<DownloadSettingsSnapshot>{
  const values=validateConfig(input),host=input.host.trim()?normalizeSiteHost(input.host):''
  return serializeMutation(async()=>{const settings=await loadDownloadSettings();if(host)settings.sites[host]=values;else settings.global=values;await saveDownloadSettingsFile(settings);return downloadSettingsSnapshot(settings,host||undefined)})
}

export async function restoreNovelSiteDefaults(rawHost:string):Promise<DownloadSettingsSnapshot>{
  const host=normalizeSiteHost(rawHost);return serializeMutation(async()=>{const settings=await loadDownloadSettings();delete settings.sites[host];await saveDownloadSettingsFile(settings);return downloadSettingsSnapshot(settings,host)})
}

export async function resumeNovelSite(rawHost:string):Promise<DownloadSettingsSnapshot>{
  const host=normalizeSiteHost(rawHost);return serializeMutation(async()=>{const settings=await loadDownloadSettings();settings.siteStates[host]={browserFallbackAuthorized:true};await saveDownloadSettingsFile(settings);requestScheduler.resumeSite(host);return downloadSettingsSnapshot(settings,host)})
}

async function saveSiteState(host:string,state:{pausedReason?:string;blockedUntil?:number;browserFallbackAuthorized?:boolean}):Promise<void>{
  await serializeMutation(async()=>{const settings=await loadDownloadSettings(),normalized=normalizeSiteHost(host),next={...(settings.siteStates[normalized]??{}),...state};if(!next.pausedReason&&!next.blockedUntil)delete settings.siteStates[normalized];else settings.siteStates[normalized]=next;await saveDownloadSettingsFile(settings)})
}

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation)
  mutationQueue = result.then(() => undefined, () => undefined)
  return result
}

async function withTaskOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  if (deletingTasks.has(id)) throw new Error('该小说正在删除，暂不能执行文件操作。')
  const previous = taskOperations.get(id) ?? Promise.resolve()
  const current = previous.then(operation, operation)
  const tracked = current.then(() => undefined, () => undefined)
  taskOperations.set(id, tracked)
  try { return await current }
  finally { if (taskOperations.get(id) === tracked) taskOperations.delete(id) }
}

async function updateTask(id: string, mutate: (task: NovelTask) => NovelTask): Promise<NovelTask> {
  return serializeMutation(async () => {
    const tasks = await loadTasks()
    const index = tasks.findIndex((task) => task.id === id)
    if (index < 0) throw new Error('找不到该下载任务。')
    tasks[index] = { ...mutate(tasks[index]), updatedAt: new Date().toISOString() }
    await saveTasks(tasks)
    return tasks[index]
  })
}

async function exportNovelTxt(task: NovelTask): Promise<string> {
  if (task.outputPath) {
    try { await access(task.outputPath); return task.outputPath } catch { /* recreate a missing export from saved chapter files */ }
  }
  const folder = path.join(app.getPath('documents'), 'BookMind', 'Books', `${safeNovelName(task.name)}-${task.id.slice(0, 8)}`)
  await mkdir(folder, { recursive: true })
  const outputPath = path.join(folder, `${safeNovelName(task.name)}.txt`)
  const parts: string[] = []
  const chapters=normalizeChapterOrder(task.chapters,false).sort((left,right)=>(left.position??0)-(right.position??0))
  let previousNumber=0
  for (const chapter of chapters) {
    const number=chapter.chapterNumber??chapterOrdinal(chapter.title)
    if(number!==null&&number<previousNumber)throw new Error(`TXT 合并前校验失败：${chapter.title} 的章节顺序异常。`)
    if(number!==null)previousNumber=number
    const content=await readFile(path.join(taskRoot(), task.id, 'chapters', `${chapter.id}.txt`), 'utf-8')
    if(!content.startsWith(`${chapter.title}\n\n`))throw new Error(`TXT 合并前校验失败：章节文件与标题“${chapter.title}”不匹配。`)
    parts.push(content)
  }
  await writeFile(outputPath, parts.join('\n\n'), 'utf-8')
  return outputPath
}

async function adapterFor(input: string): Promise<{ adapter: NovelAdapter; url: URL }> {
  let url: URL
  try { url = new URL(input) } catch { throw new Error('请输入有效的小说目录页 URL。') }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('仅允许 HTTPS 官方站点 URL，且不能包含账号、密码或自定义端口。')
  }
  const adapter = adapters.find((item) => item.matches(url))
  if (adapter) return { adapter, url }
  const registered = await getRegisteredNovelAdapter(url.hostname.toLowerCase())
  if (!registered) throw new Error('暂不支持该网站。请在“AI 接入新站点”中生成并验证专属 Adapter。')
  return { adapter: registered, url }
}

export async function parseNovel(url: string): Promise<NovelMetadata> {
  await initialize()
  const { adapter, url: parsedUrl } = await adapterFor(url)
  return adapter.parse(parsedUrl)
}

export async function createNovelTask(metadata: NovelMetadata): Promise<NovelTask> {
  await initialize()
  if (!metadata || !Array.isArray(metadata.chapters) || metadata.chapters.length === 0 || metadata.chapters.length > 5000) {
    throw new Error('小说目录无有效章节，或章节数量超出限制。')
  }
  const reportedIntegrity=metadata.catalogIntegrity
  const {chapters:dedupedChapters,duplicateLinkCount:duplicateCount,urlTitleMismatchCount}=dedupeNovelChapters(metadata.chapters)
  const uniqueChapters=normalizeChapterOrder(dedupedChapters)
  assertCatalogHasChapters(inspectNovelCatalog(uniqueChapters,reportedIntegrity?.expectedChapterCount,(reportedIntegrity?.duplicateLinkCount??0)+duplicateCount,(reportedIntegrity?.urlTitleMismatchCount??0)+urlTitleMismatchCount))
  // Keep catalog issues visible to the caller, but gaps, duplicates, or source ordering do not prevent a task.
  const { adapter } = await adapterFor(metadata.sourceUrl)
  for (const chapter of uniqueChapters) {
    const chapterUrl = new URL(chapter.url)
    if (!adapter.matches(chapterUrl) || chapterUrl.protocol !== 'https:') throw new Error('章节链接不属于已验证的安全来源。')
  }
  const now = new Date().toISOString()
  const task: NovelTask = {
    id: randomUUID(), sourceUrl: metadata.sourceUrl, name: metadata.name.slice(0, 200), author: metadata.author.slice(0, 200),
    chapters: uniqueChapters.map((chapter, index) => ({ id: String(index + 1), title: String(chapter.title).slice(0, 300), url: String(chapter.url), chapterNumber: chapter.chapterNumber??chapterOrdinal(chapter.title), specialType: chapter.specialType??(chapterOrdinal(chapter.title)===null?'other':'numbered'), position: index+1, status: 'pending' })),
    status: 'ready', outputPath: null, createdAt: now, updatedAt: now,
  }
  await mkdir(path.join(taskRoot(), task.id, 'chapters'), { recursive: true })
  await serializeMutation(async () => saveTasks([task, ...(await loadTasks())]))
  return task
}

export async function listNovelTasks(): Promise<NovelTask[]> {
  await initialize()
  return loadTasks()
}

async function runTask(id: string, retryOnly: boolean): Promise<void> {
  const control = controls.get(id) ?? { paused: false, cancelled: false, retryOnly }
  controls.set(id, control)
  const claimed=new Set<string>()
  let siteHost=''
  try {
    await updateTask(id, (task) => ({ ...task, status: 'downloading', error: undefined }))
    const initial = (await loadTasks()).find((task) => task.id === id)
    if (!initial) return
    siteHost=normalizeSiteHost(new URL(initial.sourceUrl).hostname)
    const { adapter } = await adapterFor(initial.sourceUrl)
    const worker = async () => {
      while (!control.cancelled && !control.paused) {
        const current=(await loadTasks()).find((task)=>task.id===id)
        if(!current)return
        const now=Date.now()
        const eligible=current.chapters.find(chapter=>!claimed.has(chapter.id)&&chapter.status==='retry-wait'&&isChapterEligible(chapter,retryOnly,now))
          ||current.chapters.find(chapter=>!claimed.has(chapter.id)&&isChapterEligible(chapter,retryOnly,now))
        if(!eligible){
          const waiting=current.chapters.filter(chapter=>chapter.status==='retry-wait'&&chapter.retryAt&&chapter.retryAt>now)
          if(!waiting.length)return
          await pause(Math.min(250,Math.max(25,Math.min(...waiting.map(chapter=>chapter.retryAt!))-now)))
          continue
        }
        const chapter=eligible;claimed.add(chapter.id)
        let release:(()=>void)|undefined
        let requeueAfterBackoff=false
        try {
          const settings=await loadDownloadSettings(),effective=effectiveSiteConfig(settings,siteHost),siteState=settings.siteStates[siteHost]
          requestScheduler.setPersistedState(siteHost,siteState?.pausedReason,siteState?.blockedUntil)
          release=await requestScheduler.acquire(siteHost,chapter.url,{concurrency:effective.concurrency,requestIntervalSeconds:effective.requestIntervalSeconds,cancelled:()=>control.cancelled||control.paused})
          if(control.cancelled||control.paused){await updateTask(id,task=>({...task,chapters:task.chapters.map(item=>item.id===chapter.id?{...item,status:'pending'}:item)}));return}
          await updateTask(id, (task) => ({ ...task, chapters: task.chapters.map((item) => item.id === chapter.id ? { ...item, status: 'downloading', error: undefined, retryAt: undefined,retryCount:retryOnly&&item.status==='failed'?0:item.retryCount } : item) }))
          const chapterFile=path.join(taskRoot(),id,'chapters',`${chapter.id}.txt`)
          try{const saved=await readFile(chapterFile,'utf-8');if(saved.length>chapter.title.length+2){await updateTask(id,task=>({...task,chapters:task.chapters.map(item=>item.id===chapter.id?{...item,status:'completed',retryAt:undefined,error:undefined}:item)}));continue}}catch{/* chapter has not been atomically saved yet */}
          const body = await adapter.fetchChapter(chapter.url)
          if (control.cancelled || deletingTasks.has(id)) {
            await updateTask(id, task => ({ ...task, chapters: task.chapters.map(item => item.id === chapter.id ? { ...item, status: 'pending', retryAt: undefined } : item) }))
            return
          }
          if(!body.trim())throw new NovelDownloadError('parse','章节正文为空，未保存。')
          const temporary=`${chapterFile}.${randomUUID()}.tmp`;await writeFile(temporary,`${chapter.title}\n\n${body}\n`,'utf-8')
          if (control.cancelled || deletingTasks.has(id)) { await rm(temporary, { force: true }); return }
          await rename(temporary,chapterFile)
          await updateTask(id, (task) => ({ ...task, chapters: task.chapters.map((item) => item.id === chapter.id ? { ...item, status: 'completed', error: undefined, retryAt: undefined } : item) }))
        } catch (error) {
          const failure=classifyDownloadFailure(error),message=failure.message||'章节下载失败。'
          if(control.cancelled||control.paused){await updateTask(id,task=>({...task,chapters:task.chapters.map(item=>item.id===chapter.id?{...item,status:'pending',retryAt:undefined}:item)}))}
          else if(failure.kind==='access'){
            const currentPause=requestScheduler.siteStatus(siteHost).pausedReason
            const reason=(currentPause||message.replace(/^网站\s+[^\s]+\s+已暂停：/,'')).slice(0,300)
            control.paused=true;requestScheduler.pauseSite(siteHost,reason);await saveSiteState(siteHost,{pausedReason:reason,browserFallbackAuthorized:false})
            await updateTask(id,task=>({...task,status:'paused',error:`网站 ${siteHost} 已暂停：${reason}`,chapters:task.chapters.map(item=>item.id===chapter.id?{...item,status:'retry-wait',retryAt:undefined,error:'等待网站恢复后重试。'}:item)}))
          }else if(failure.kind==='rate-limit'){
            const blockedUntil=Date.now()+(failure.retryAfterMs??60_000);requestScheduler.blockUntil(siteHost,blockedUntil);await saveSiteState(siteHost,{blockedUntil})
            const config=effectiveSiteConfig(await loadDownloadSettings(),siteHost),retryCount=retryOnly&&chapter.status==='failed'?0:chapter.retryCount??0
            const retryAt=blockedUntil
            requeueAfterBackoff=config.autoRetry&&retryCount<config.maxRetries
            await updateTask(id,task=>({...task,chapters:task.chapters.map(item=>item.id===chapter.id?{...item,status:requeueAfterBackoff?'retry-wait':'failed',retryCount:requeueAfterBackoff?retryCount+1:retryCount,retryAt:requeueAfterBackoff?retryAt:undefined,error:message.slice(0,300)}:item)}))
          }else if(failure.kind==='network'||failure.kind==='server'){
            const config=effectiveSiteConfig(await loadDownloadSettings(),siteHost),retryCount=retryOnly&&chapter.status==='failed'?0:chapter.retryCount??0,canRetry=config.autoRetry&&retryCount<config.maxRetries
            requeueAfterBackoff=canRetry
            await updateTask(id,task=>({...task,chapters:task.chapters.map(item=>item.id===chapter.id?{...item,status:canRetry?'retry-wait':'failed',retryCount:canRetry?retryCount+1:retryCount,retryAt:canRetry?Date.now()+retryDelayMs(retryCount):undefined,error:message.slice(0,300)}:item)}))
          }else await updateTask(id,task=>({...task,chapters:task.chapters.map(item=>item.id===chapter.id?{...item,status:'failed',retryAt:undefined,error:message.slice(0,300)}:item)}))
        }finally{
          release?.()
          if(requeueAfterBackoff)claimed.delete(chapter.id)
        }
      }
    }
    await Promise.all(Array.from({ length: MAX_WORKERS }, () => worker()))
  } catch (error) {
    const message=error instanceof Error?error.message:'下载任务启动失败。'
    await updateTask(id, (task) => ({ ...task, status: control.cancelled ? 'cancelled' : 'paused',error:message.slice(0,300) })).catch(() => undefined)
    controls.delete(id)
    return
  }
  const finished = await loadTasks()
  const task = finished.find((item) => item.id === id)
  if (!task) return
  if (control.cancelled) await updateTask(id, (item) => ({ ...item, status: 'cancelled',chapters:item.chapters.map(chapter=>chapter.status==='downloading'?{...chapter,status:'pending'}:chapter) }))
  else if (control.paused) await updateTask(id, (item) => ({ ...item, status: 'paused', chapters: item.chapters.map((chapter) => chapter.status === 'downloading' ? { ...chapter, status: 'pending' } : chapter) }))
  else {
    const remaining = task.chapters.some((chapter) => chapter.status === 'pending' || chapter.status === 'downloading')
    const retryWaiting=task.chapters.some(chapter=>chapter.status==='retry-wait')
    const failed = task.chapters.some((chapter) => chapter.status === 'failed')
    if (remaining || retryWaiting) {
      await updateTask(id, (item) => ({ ...item, status: 'paused' }))
    }else if(failed){
      await updateTask(id,item=>({...item,status:'partially-completed',error:`部分章节失败（${item.chapters.filter(chapter=>chapter.status==='failed').length} 章）；成功章节已保留。`}))
    } else if (task.chapters.every(chapter => chapter.status === 'completed')) {
      try {
        const outputPath = await exportNovelTxt(task)
        await updateTask(id, (item) => ({ ...item, status: 'completed', outputPath }))
      } catch (error) {
        const message = error instanceof Error ? error.message : 'TXT 文件导出失败。'
        await updateTask(id, (item) => ({ ...item, status: 'paused', error: message.slice(0, 300) }))
      }
    } else await updateTask(id, item => ({ ...item, status: 'paused', error: '仍有未完成章节，任务已保留在正在下载列表。' }))
  }
  controls.delete(id)
}

export async function controlNovelTask(id: string, action: NovelTaskAction): Promise<NovelTask> {
  await initialize()
  if (deletingTasks.has(id)) throw new Error('该小说正在删除，暂不能操作下载任务。')
  const tasks = await loadTasks()
  const task = tasks.find((item) => item.id === id)
  if (!task) throw new Error('找不到该下载任务。')
  const host=normalizeSiteHost(new URL(task.sourceUrl).hostname)
  if (action === 'pause' || action === 'cancel') {
    const control = controls.get(id)
    if (control) {
      control.paused = action === 'pause'
      control.cancelled = action === 'cancel'
    }
    if (action === 'cancel' && !control) return updateTask(id, (item) => ({ ...item, status: 'cancelled' }))
    if (action === 'pause' && !control) return updateTask(id, (item) => ({ ...item, status: 'paused' }))
    requestScheduler.wake(host)
    return task
  }
  if (action === 'start' || action === 'resume' || action === 'retry') {
    if (taskLoops.has(id)) return task
    const siteState=(await loadDownloadSettings()).siteStates[host]
    if(siteState?.pausedReason)throw new Error(`网站 ${host} 已暂停：${siteState.pausedReason}。请先确认可以继续访问，再恢复该网站。`)
    const retryOnly = action === 'retry'
    const promise = runTask(id, retryOnly).finally(() => taskLoops.delete(id))
    taskLoops.set(id, promise)
    return updateTask(id, (item) => ({ ...item, status: 'downloading' }))
  }
  return task
}

/** Remove one task and its exact owned artifacts; records remain if filesystem cleanup fails. */
export async function deleteNovelTask(id: string): Promise<void> {
  await initialize()
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('无效的小说任务 ID。')
  if (deletingTasks.has(id)) throw new Error('该小说正在删除。')
  deletingTasks.add(id)
  try {
    const tasksBefore = await loadTasks()
    const task = tasksBefore.find(item => item.id === id)
    if (!task) throw new Error('找不到该下载任务。')
    const control = controls.get(id)
    if (control) { control.cancelled = true; control.paused = false }
    requestScheduler.wake(normalizeSiteHost(new URL(task.sourceUrl).hostname))
    const active = taskLoops.get(id)
    if (active) {
      try { await active } catch { /* runTask persists cancellation itself */ }
    }
    await taskOperations.get(id)

    const ownedPaths = resolveOwnedNovelPaths(id, task.name, task.outputPath, app.getPath('userData'), app.getPath('documents'))
    const { exportFile } = ownedPaths

    const libraryBefore = await loadLibraryState()
    const matchingBooks = libraryBefore.books.filter(book => book.novelTaskId === id)
    for (const book of matchingBooks) {
      if (exportFile && path.resolve(book.path) !== exportFile) throw new Error('书库记录路径与小说任务路径不一致，已拒绝删除。')
      if (!exportFile) throw new Error('任务记录缺少 TXT 路径，但书库仍有关联记录；请先恢复文件路径后重试。')
    }
    const libraryAfter = {
      ...libraryBefore,
      books: libraryBefore.books.filter(book => book.novelTaskId !== id),
      progress: Object.fromEntries(Object.entries(libraryBefore.progress).filter(([bookId]) => !matchingBooks.some(book => book.id === bookId))),
      selectedBookId: matchingBooks.some(book => book.id === libraryBefore.selectedBookId) ? null : libraryBefore.selectedBookId,
    }

    let libraryCommitted = false
    try {
      // Remove exact task-owned paths first. If the OS rejects deletion (for example, a locked file), the task and library records remain for retry.
      await removeOwnedNovelArtifacts(ownedPaths)
      await saveLibraryState(libraryAfter)
      libraryCommitted = true
      await serializeMutation(async () => saveTasks((await loadTasks()).filter(item => item.id !== id)))
    } catch (error) {
      if (libraryCommitted) await saveLibraryState(libraryBefore).catch(() => undefined)
      const detail = error instanceof Error ? error.message : '未知文件系统错误'
      throw new Error(`删除失败，任务与书库记录已保留；本地文件清理未完成：${detail}`, { cause: error })
    }
  } finally {
    deletingTasks.delete(id)
  }
}

export async function importNovelTaskChapterHtml(taskId:string,chapterIndex:number,filePath:string):Promise<NovelTask>{
  return withTaskOperation(taskId, async () => {
  await initialize()
  if(taskLoops.has(taskId))throw new Error('请先暂停下载任务，再导入单章 HTML。')
  const task=(await loadTasks()).find((item)=>item.id===taskId)
  if(!task||!Number.isInteger(chapterIndex)||chapterIndex<0||chapterIndex>=task.chapters.length)throw new Error('小说章节无效。')
  const chapter=task.chapters[chapterIndex]
  if(chapter.status==='completed')throw new Error('该章节已完成，无需重复导入。')
  const body=await extractImportedNovelChapter(chapter.url,chapter.title,filePath)
  await mkdir(path.join(taskRoot(),task.id,'chapters'),{recursive:true})
  await writeFile(path.join(taskRoot(),task.id,'chapters',`${chapter.id}.txt`),`${chapter.title}\n\n${body}\n`,'utf-8')
  const updated=await updateTask(taskId,(current)=>({...current,status:'paused',chapters:current.chapters.map((item)=>item.id===chapter.id?{...item,status:'completed',error:undefined}:item)}))
  if(updated.chapters.every((item)=>item.status==='completed')){
    const outputPath=await exportNovelTxt(updated)
    return updateTask(taskId,(current)=>({...current,status:'completed',outputPath,error:undefined}))
  }
  return updated
  })
}

export async function importNovelTask(id: string): Promise<{ id: string; name: string; path: string; type: 'txt'; author: string; novelTaskId: string }> {
  return withTaskOperation(id, async () => {
  await initialize()
  const task = (await loadTasks()).find((item) => item.id === id)
  if (!task || task.status !== 'completed' || task.chapters.some((chapter) => chapter.status !== 'completed')) throw new Error('下载任务尚未完整完成，无法导入书库。')
  const outputPath = await exportNovelTxt(task)
  if (task.outputPath !== outputPath) await updateTask(id, (item) => ({ ...item, outputPath }))
  return { id: randomUUID(), name: task.name, path: outputPath, type: 'txt', author: task.author, novelTaskId: task.id }
  })
}

export async function readNovelChapter(taskId: string, chapterIndex: number): Promise<{ title: string; content: string }> {
  await initialize()
  const task = (await loadTasks()).find((item) => item.id === taskId)
  if (!task || !Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= task.chapters.length) throw new Error('小说章节无效。')
  const chapter = task.chapters[chapterIndex]
  if (chapter.status !== 'completed') throw new Error('该章节尚未下载完成。')
  const content = await readFile(path.join(taskRoot(), task.id, 'chapters', `${chapter.id}.txt`), 'utf-8')
  return { title: chapter.title, content: content.slice(content.indexOf('\n\n') + 2) }
}

export async function listNovelBookChapters(taskId: string): Promise<Array<{ title: string }>> {
  await initialize()
  const task = (await loadTasks()).find((item) => item.id === taskId)
  if (!task) throw new Error('找不到已导入小说对应的下载任务。')
  return task.chapters.map(({ title }) => ({ title }))
}

export async function getNovelAiAnalysisSource(bookId:string):Promise<{bookId:string;bookName:string;author?:string;taskId:string;chapters:Array<{id:string;title:string;chapterNumber:number|null;position:number;status:'completed'|'failed'|'pending'}>}>{
  await initialize()
  const library=await loadLibraryState(),book=library.books.find(item=>item.id===bookId)
  if(!book)throw new Error('这本书已不在当前书库中。')
  if(!book.novelTaskId||!(book.type==='txt'||book.path.toLowerCase().endsWith('.txt')))throw new Error('AI 章节分析目前需要从 BookMind 下载并导入、带章节索引的 TXT 小说。')
  const task=(await loadTasks()).find(item=>item.id===book.novelTaskId)
  if(!task)throw new Error('找不到这本 TXT 小说的本地章节记录。')
  const chapters=task.chapters.map((chapter,index)=>({id:chapter.id,title:chapter.title,chapterNumber:chapter.chapterNumber??chapterOrdinal(chapter.title),position:chapter.position??index+1,status:chapter.status==='completed'?'completed' as const:chapter.status==='failed'?'failed' as const:'pending' as const}))
  if(chapters.some(chapter=>chapter.status!=='completed'))throw new Error('小说仍有未下载完成的章节，请先完成下载后再进行 AI 分析。')
  return {bookId:book.id,bookName:book.name,author:book.author,taskId:task.id,chapters}
}

export async function readNovelAiAnalysisChapter(bookId:string,chapterId:string):Promise<{id:string;title:string;chapterNumber:number|null;position:number;content:string}>{
  const source=await getNovelAiAnalysisSource(bookId),chapter=source.chapters.find(item=>item.id===chapterId)
  if(!chapter)throw new Error('分析任务中的章节已不在本地章节目录中。')
  const raw=await readFile(path.join(taskRoot(),source.taskId,'chapters',`${chapter.id}.txt`),'utf-8')
  const titlePrefix=`${chapter.title}\n\n`
  if(!raw.startsWith(titlePrefix))throw new Error(`章节文件与目录标题不匹配：“${chapter.title}”。`)
  const content=raw.slice(titlePrefix.length).trim()
  if(!content)throw new Error(`章节“${chapter.title}”没有可分析的正文。`)
  return {...chapter,content}
}

export async function getNovelOutputFolder(taskId: string): Promise<string> {
  await initialize()
  const task = (await loadTasks()).find((item) => item.id === taskId)
  if (!task) throw new Error('找不到该下载任务。')
  return task.outputPath ? path.dirname(task.outputPath) : path.join(taskRoot(), task.id)
}
