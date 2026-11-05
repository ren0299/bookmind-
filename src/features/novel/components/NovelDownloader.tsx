import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiAdapterManualInput, AiIntegrationSettingsInput, AdapterHtmlImport, AdapterHtmlKind, AiModelOption, AiProviderOption, DownloadConfigValues, DownloadSettingsSnapshot, NovelMetadata, NovelTask, NovelTaskAction } from '../../../../shared/types/novel.ts'
import { partitionNovelTasks } from '../../../../shared/lib/novel-task-state.ts'
import { inspectNovelCatalog } from '../../../../shared/lib/catalog-integrity.ts'
import { controlNovelTask, createNovelTask, deleteNovelTask, getAiIntegrationStatus, getAiModels, getNovelDownloadSettings, importAdapterHtml, importNovelTaskChapterHtml, listAiProviders, listNovelTasks, openNovelFolder, openNovelPreview, parseNovel, registerAiNovelAdapter, restoreNovelSiteDefaults, resumeNovelSite, saveAiIntegrationSettings, saveNovelDownloadSettings, verifyAiIntegration } from '../../../services/library.ts'

interface NovelDownloaderProps { onImport: (taskId: string) => Promise<void>; onRemoveNovel: (taskId: string) => void }

export function NovelDownloader({ onImport, onRemoveNovel }: NovelDownloaderProps) {
  const [url, setUrl] = useState('')
  const [metadata, setMetadata] = useState<NovelMetadata | null>(null)
  const [tasks, setTasks] = useState<NovelTask[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importedTaskIds, setImportedTaskIds] = useState<Set<string>>(() => new Set())
  const [dialog, setDialog] = useState<'settings' | 'adapter' | 'scheduler' | null>(null)
  const [apiProvider, setApiProvider] = useState('openai')
  const [providers, setProviders] = useState<AiProviderOption[]>([])
  const [models, setModels] = useState<AiModelOption[]>([])
  const [apiModel, setApiModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [adapterUrl, setAdapterUrl] = useState('')
  const [sampleChapterUrl, setSampleChapterUrl] = useState('')
  const [catalogHtml, setCatalogHtml] = useState<AdapterHtmlImport | null>(null)
  const [chapterHtml, setChapterHtml] = useState<AdapterHtmlImport | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMessage, setAiMessage] = useState<string | null>(null)
  const [hasSavedKey, setHasSavedKey] = useState(false)
  const [savedProvider, setSavedProvider] = useState('')
  const [loadingModels, setLoadingModels] = useState(false)
  const [downloadHost,setDownloadHost]=useState('')
  const [downloadConfig,setDownloadConfig]=useState<DownloadConfigValues>({concurrency:2,requestIntervalSeconds:3,maxRetries:3,autoRetry:true})
  const [downloadSnapshot,setDownloadSnapshot]=useState<DownloadSettingsSnapshot|null>(null)
  const [schedulerBusy,setSchedulerBusy]=useState(false)
  const [taskTab,setTaskTab]=useState<'active'|'completed'>('active')
  const [deleteTarget,setDeleteTarget]=useState<NovelTask|null>(null)
  const [deleting,setDeleting]=useState(false)
  const autoImportStarted = useRef(new Set<string>())
  const { active: activeTasks, completed: completedTasks } = partitionNovelTasks(tasks)
  const visibleTasks = taskTab === 'active' ? activeTasks : completedTasks
  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null
  const completed = selectedTask?.chapters.filter((chapter) => chapter.status === 'completed').length ?? 0
  const failed = selectedTask?.chapters.filter((chapter) => chapter.status === 'failed').length ?? 0
  const retryWaiting=selectedTask?.chapters.filter((chapter)=>chapter.status==='retry-wait').length??0
  const downloading=selectedTask?.chapters.filter((chapter)=>chapter.status==='downloading').length??0
  const total = selectedTask?.chapters.length ?? 0
  const percent = total ? Math.round(completed / total * 100) : 0
  const canImport = selectedTask?.status === 'completed' && failed === 0
  const pendingParse = useMemo(() => metadata !== null, [metadata])
  const catalogIntegrity = metadata ? metadata.catalogIntegrity ?? inspectNovelCatalog(metadata.chapters, undefined, 0) : null

  const refresh = useCallback(async () => {
    try {
      const value = await listNovelTasks()
      setTasks(value)
      setSelectedId((current) => current && value.some((task) => task.id === current && (taskTab === 'completed' ? task.status === 'completed' : task.status !== 'completed')) ? current : (taskTab === 'completed' ? value.find(task => task.status === 'completed') : value.find(task => task.status !== 'completed'))?.id ?? null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取任务记录失败。')
    }
  }, [taskTab])

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => void refresh(), 1500)
    return () => { window.clearTimeout(initial); window.clearInterval(timer) }
  }, [refresh])

  useEffect(() => {
    for (const task of tasks) {
      if (task.status !== 'completed' || autoImportStarted.current.has(task.id)) continue
      autoImportStarted.current.add(task.id)
      void onImport(task.id).then(() => {
        setImportedTaskIds((current) => new Set(current).add(task.id))
        setNotice(`《${task.name}》已完成，TXT 已保存并加入书库。`)
      }).catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : '小说已下载，但加入书库失败。')
      })
    }
  }, [tasks, onImport])

  async function handleParse() {
    setBusy(true); setError(null); setNotice(null); setMetadata(null)
    try {
      const result = await parseNovel(url.trim())
      setMetadata(result)
      setNotice('解析成功。确认目录后即可创建下载任务。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '解析失败。')
    } finally { setBusy(false) }
  }

  async function handleCreate() {
    if (!metadata) return
    setBusy(true); setError(null)
    try {
      const task = await createNovelTask(metadata)
      setMetadata(null); setSelectedId(task.id); await refresh()
      setNotice('任务已保存。点击开始下载后将按章节顺序获取正文。')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法创建任务。') }
    finally { setBusy(false) }
  }

  async function act(action: NovelTaskAction) {
    if (!selectedTask) return
    setError(null); setNotice(null)
    try { await controlNovelTask(selectedTask.id, action); await refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '任务操作失败。') }
  }

  async function handleImport() {
    if (!selectedTask) return
    setBusy(true); setError(null)
    try {
      await onImport(selectedTask.id)
      autoImportStarted.current.add(selectedTask.id)
      setImportedTaskIds((current) => new Set(current).add(selectedTask.id))
      setNotice(`《${selectedTask.name}》已加入书库。`)
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '导入书库失败。') }
    finally { setBusy(false) }
  }
  async function importTaskChapter(index:number) {
    if(!selectedTask)return
    setBusy(true);setError(null);setNotice(null)
    try { const updated=await importNovelTaskChapterHtml(selectedTask.id,index);if(updated){await refresh();setNotice(`《${updated.name}》${updated.chapters[index].title} 已从本地 HTML 导入。`)}}
    catch(cause){setError(cause instanceof Error?cause.message:'导入章节 HTML 失败。')}
    finally{setBusy(false)}
  }
  async function previewTaskChapter(chapterUrl:string) {
    try{await openNovelPreview(chapterUrl)}catch(cause){setError(cause instanceof Error?cause.message:'无法打开章节预览。')}
  }

  async function confirmDeleteTask() {
    if (!deleteTarget || deleting) return
    const target = deleteTarget
    setDeleting(true); setError(null); setNotice(null)
    try {
      await deleteNovelTask(target.id)
      onRemoveNovel(target.id)
      autoImportStarted.current.delete(target.id)
      const remaining = visibleTasks.filter(task => task.id !== target.id)
      setSelectedId(remaining[0]?.id ?? null)
      setDeleteTarget(null)
      await refresh()
      setNotice(`《${target.name}》及其下载文件和书库记录已删除。`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除小说失败。')
    } finally { setDeleting(false) }
  }

  function changeTaskTab(tab: 'active'|'completed') {
    setTaskTab(tab)
    const collection = tab === 'completed' ? completedTasks : activeTasks
    setSelectedId(collection[0]?.id ?? null)
  }

  async function openSettings() {
    try {
      const [status, availableProviders] = await Promise.all([getAiIntegrationStatus(), listAiProviders()])
      setProviders(availableProviders)
      const provider = availableProviders.some((item) => item.id === status.provider) ? status.provider : availableProviders[0]?.id || 'openai'
      setApiProvider(provider); setApiModel(status.model || availableProviders.find((item) => item.id === provider)?.recommendedModel || ''); setHasSavedKey(status.hasApiKey); setSavedProvider(status.provider); setApiKey(''); setAiMessage(null); setModels([]); setDialog('settings')
      if (status.hasApiKey && provider === status.provider) void loadModels(provider, '')
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取 AI 配置。') }
  }
  async function openDownloadSettings(host?:string){
    const proposed=host||(selectedTask?new URL(selectedTask.sourceUrl).hostname:(()=>{try{return new URL(url).hostname}catch{return ''}})())
    setDownloadHost(proposed);setSchedulerBusy(true);setDialog('scheduler')
    try{const snapshot=await getNovelDownloadSettings(proposed||undefined);setDownloadSnapshot(snapshot);setDownloadConfig(snapshot.site??snapshot.global)}catch(cause){setError(cause instanceof Error?cause.message:'读取下载设置失败。')}
    finally{setSchedulerBusy(false)}
  }
  async function loadDownloadHost(){
    setSchedulerBusy(true)
    try{const snapshot=await getNovelDownloadSettings(downloadHost.trim()||undefined);setDownloadSnapshot(snapshot);setDownloadConfig(snapshot.site??snapshot.global)}catch(cause){setError(cause instanceof Error?cause.message:'读取下载设置失败。')}
    finally{setSchedulerBusy(false)}
  }
  async function saveDownloadConfig(){
    setSchedulerBusy(true)
    try{const snapshot=await saveNovelDownloadSettings({host:downloadHost.trim(),...downloadConfig});setDownloadSnapshot(snapshot);setDownloadConfig(snapshot.site??snapshot.global);setNotice(downloadHost.trim()?`已保存 ${snapshot.site?.host} 的独立下载设置。`:'已保存全局默认下载设置。')}
    catch(cause){setError(cause instanceof Error?cause.message:'保存下载设置失败。')}
    finally{setSchedulerBusy(false)}
  }
  async function restoreSiteConfig(){
    if(!downloadHost.trim())return
    setSchedulerBusy(true)
    try{const snapshot=await restoreNovelSiteDefaults(downloadHost.trim());setDownloadSnapshot(snapshot);setDownloadConfig(snapshot.site??snapshot.global);setNotice('该网站已恢复继承全局默认设置。')}
    catch(cause){setError(cause instanceof Error?cause.message:'恢复网站默认设置失败。')}
    finally{setSchedulerBusy(false)}
  }
  async function resumeSite(){
    if(!downloadHost.trim()||!window.confirm(`确认网站 ${downloadHost.trim()} 已允许继续访问，并恢复该网站的下载请求？`))return
    setSchedulerBusy(true)
    try{const snapshot=await resumeNovelSite(downloadHost.trim());setDownloadSnapshot(snapshot);setNotice(`已解除 ${snapshot.site?.host} 的网站暂停。若普通请求仍被拒绝，BookMind 会尝试隔离的浏览器页面加载；如遇验证挑战会再次暂停，不会自动验证。请继续对应下载任务。`);await refresh()}
    catch(cause){setError(cause instanceof Error?cause.message:'恢复网站失败。')}
    finally{setSchedulerBusy(false)}
  }
  function aiSettings(): AiIntegrationSettingsInput { return { provider: apiProvider, model: apiModel, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) } }
  async function loadModels(provider = apiProvider, key = apiKey) {
    setLoadingModels(true)
    try { const choices = await getAiModels(provider, key.trim() || undefined); setModels(choices); const recommended = providers.find((item) => item.id === provider)?.recommendedModel; if (!choices.some((item) => item.id === apiModel)) setApiModel(choices.some((item) => item.id === recommended) ? recommended! : choices[0]?.id || recommended || '') }
    catch (cause) { setModels([]); setAiMessage(cause instanceof Error ? cause.message : '读取模型列表失败。') }
    finally { setLoadingModels(false) }
  }
  function changeProvider(provider: string) { setApiProvider(provider); setApiModel(providers.find((item) => item.id === provider)?.recommendedModel || ''); setModels([]); setAiMessage(null) }
  async function handleSaveAi() {
    setAiBusy(true); setAiMessage(null)
    try { const status = await saveAiIntegrationSettings(aiSettings()); setHasSavedKey(status.hasApiKey); setSavedProvider(status.provider); setApiKey(''); setAiMessage('设置已安全保存。') }
    catch (cause) { setAiMessage(cause instanceof Error ? cause.message : '保存失败。') }
    finally { setAiBusy(false) }
  }
  async function handleVerifyAi() {
    setAiBusy(true); setAiMessage(null)
    try { const result = await verifyAiIntegration(aiSettings()); setAiMessage(`连接成功（${result.model}）：${result.message}`) }
    catch (cause) { setAiMessage(cause instanceof Error ? cause.message : '连接验证失败。') }
    finally { setAiBusy(false) }
  }
  async function importHtml(kind: AdapterHtmlKind) {
    setAiBusy(true); setAiMessage(null)
    try {
      const source = kind === 'catalog' ? adapterUrl.trim() : sampleChapterUrl.trim()
      if (!source) throw new Error(kind === 'catalog' ? '请先输入目录页 URL。' : '请先输入样章 URL。')
      const receipt = await importAdapterHtml(kind, source)
      if (!receipt) return
      if (kind === 'catalog') setCatalogHtml(receipt); else setChapterHtml(receipt)
      setAiMessage(`已导入并清理 ${receipt.fileName}（${receipt.htmlLength.toLocaleString()} 字符）。`)
    } catch (cause) { setAiMessage(cause instanceof Error ? cause.message : 'HTML 导入失败。') }
    finally { setAiBusy(false) }
  }
  async function previewPage(target: string) {
    setAiBusy(true); setAiMessage(null)
    try { await openNovelPreview(target.trim()) }
    catch (cause) { setAiMessage(cause instanceof Error ? cause.message : '网页预览打开失败。') }
    finally { setAiBusy(false) }
  }
  async function handleRegisterAdapter(manual?: AiAdapterManualInput) {
    setAiBusy(true); setAiMessage(null); setError(null)
    try { const result = await registerAiNovelAdapter(adapterUrl.trim(), manual); setDialog(null); setUrl(adapterUrl.trim()); setNotice(result.message); if (result.metadata) { setMetadata(result.metadata); setError(null) } else await handleParse() }
    catch (cause) { setAiMessage(cause instanceof Error ? cause.message : 'Adapter 注册失败。') }
    finally { setAiBusy(false) }
  }

  return <main className="main-content novel-page">
    <div className="novel-shell">
      <div className="novel-heading">
        <div><p className="novel-eyebrow">BOOKMIND LIBRARY</p><h1>小说下载</h1><p>解析公开可访问的小说目录，分章节下载并保存为 UTF-8 TXT。</p></div>
      </div>
      <section className="novel-panel novel-source">
        <label htmlFor="novel-url">小说网站 URL</label>
        <div className="novel-url-row"><input id="novel-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleParse() }} placeholder="https://www.gutenberg.org/ebooks/1342" /><button className="primary-action" onClick={() => void handleParse()} disabled={busy || !url.trim()}>{busy ? '处理中…' : '解析小说'}</button></div>
        <div className="novel-ai-actions"><button className="subtle-action" onClick={() => void openSettings()}>API 接口设置</button><button className="subtle-action" onClick={() => void openDownloadSettings()}>下载调度设置</button><button className="subtle-action" onClick={() => { setAdapterUrl(url); setAiMessage(null); setDialog('adapter') }}>AI 注册新网站 Adapter</button></div>
        <small>支持 Project Gutenberg 官方 HTTPS 页面和 jpxs123.com 小说目录/章节页；不会访问登录、验证码或付费内容。</small>
      </section>
      {error && <div className="novel-alert novel-alert--error" role="alert">{error}</div>}
      {notice && <div className="novel-alert" role="status">{notice}</div>}
      {(dialog==='settings'||dialog==='adapter') && <div className="novel-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}><section className={`novel-panel novel-modal${dialog === 'adapter' ? ' novel-modal--adapter' : ''}`} role="dialog" aria-modal="true" aria-labelledby="novel-ai-dialog-title">
        <div className="novel-section-heading"><h2 id="novel-ai-dialog-title">{dialog === 'settings' ? 'AI 接口设置' : 'AI 接入新站点'}</h2><button className="subtle-action" onClick={() => setDialog(null)}>关闭</button></div>
        {dialog === 'settings' ? <><label>API 服务商<select value={apiProvider} onChange={(e) => changeProvider(e.target.value)}>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}</select></label><label>API Key<input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} onBlur={() => { if (apiKey.trim()) void loadModels(apiProvider, apiKey) }} placeholder={hasSavedKey && apiProvider === savedProvider ? '已保存密钥；留空则保持不变' : '粘贴该服务商的 API Key'} /></label><div className="novel-provider-info"><span>API 地址</span><code>{providers.find((item) => item.id === apiProvider)?.baseUrl}</code></div><label>可用模型<select value={apiModel} onChange={(e) => setApiModel(e.target.value)}>{!models.some((item) => item.id === apiModel) && apiModel && <option value={apiModel}>{apiModel}（推荐）</option>}{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label><div className="novel-ai-actions"><small>{loadingModels ? '正在获取可用模型…' : models.length ? `已读取 ${models.length} 个模型` : '先选择模型推荐值；输入 API Key 后自动获取可用模型'}</small><button className="subtle-action" disabled={loadingModels || (!apiKey.trim() && (!hasSavedKey || savedProvider !== apiProvider))} onClick={() => void loadModels(apiProvider, apiKey)}>{loadingModels ? '读取中…' : '刷新模型列表'}</button></div><small>密钥使用系统安全存储加密，不会返回到页面。</small><div className="novel-actions"><button className="subtle-action" disabled={aiBusy} onClick={() => void handleVerifyAi()}>测试连接</button><button className="primary-action" disabled={aiBusy} onClick={() => void handleSaveAi()}>保存</button></div></> : <><label>公开小说目录页 URL<input type="url" value={adapterUrl} onChange={(e) => { setAdapterUrl(e.target.value); setCatalogHtml(null) }} placeholder="https://example.com/book/..." /></label><div className="novel-ai-actions"><button className="subtle-action" disabled={aiBusy || !adapterUrl.trim()} onClick={() => void previewPage(adapterUrl)}>预览目录网页</button><button className="subtle-action" disabled={aiBusy || !adapterUrl.trim()} onClick={() => void importHtml('catalog')}>导入已保存目录 HTML</button></div>{catalogHtml && <small>目录：{catalogHtml.fileName} · {catalogHtml.title} · {catalogHtml.htmlLength.toLocaleString()} 字符</small>}<label>公开样章 URL<input type="url" value={sampleChapterUrl} onChange={(e) => { setSampleChapterUrl(e.target.value); setChapterHtml(null) }} placeholder="粘贴目录里一个公开章节链接" /></label><div className="novel-ai-actions"><button className="subtle-action" disabled={aiBusy || !sampleChapterUrl.trim()} onClick={() => void previewPage(sampleChapterUrl)}>预览样章网页</button><button className="subtle-action" disabled={aiBusy || !sampleChapterUrl.trim()} onClick={() => void importHtml('chapter')}>导入已保存样章 HTML</button></div>{chapterHtml && <small>样章：{chapterHtml.fileName} · {chapterHtml.title} · {chapterHtml.htmlLength.toLocaleString()} 字符</small>}<p className="novel-muted">如网站要求验证，请在单独的预览窗口中按站点正常流程操作，再用窗口菜单“网页 → 保存当前页面为 HTML”。返回这里分别导入目录页和样章页。导入内容会移除脚本、表单、活动内容和敏感链接参数；BookMind 不会读取或复用 Cookie/验证令牌。自动下载仍须得到网站允许。</p><p className="novel-muted">{catalogHtml && chapterHtml ? '目录和样章 HTML 已就绪。若普通请求被 Cloudflare 拒绝，请使用“分析导入页面”继续；此操作不会再次请求原网页。' : '没有导入页面时，可尝试直接访问；如果站点拒绝自动请求，请改用上方的预览和 HTML 导入。'}</p><button className={catalogHtml && chapterHtml ? "subtle-action" : "primary-action"} disabled={aiBusy || !adapterUrl.trim()} onClick={() => void handleRegisterAdapter()}>{aiBusy ? '生成并验证中…' : '尝试直接访问并验证 Adapter'}</button><button className={catalogHtml && chapterHtml ? "primary-action" : "subtle-action"} disabled={aiBusy || !catalogHtml || !chapterHtml || !adapterUrl.trim() || !sampleChapterUrl.trim()} onClick={() => void handleRegisterAdapter({ catalogImportId: catalogHtml!.id, chapterImportId: chapterHtml!.id, chapterUrl: sampleChapterUrl.trim() })}>{aiBusy ? '分析并验证中…' : '分析导入页面并验证 Adapter'}</button></>}
        {aiMessage && <div className="novel-alert" role="status">{aiMessage}</div>}
      </section></div>}
      {dialog==='scheduler'&&<div className="novel-modal-backdrop" role="presentation" onMouseDown={event=>{if(event.target===event.currentTarget)setDialog(null)}}><section className="novel-panel novel-modal novel-scheduler-modal" role="dialog" aria-modal="true" aria-labelledby="scheduler-title">
        <div className="novel-section-heading"><h2 id="scheduler-title">下载调度设置</h2><button className="subtle-action" onClick={()=>setDialog(null)}>关闭</button></div>
        <label>网站域名（留空编辑全局默认）<div className="novel-url-row"><input value={downloadHost} onChange={event=>setDownloadHost(event.target.value)} placeholder="例如 twkan.com"/><button className="subtle-action" disabled={schedulerBusy} onClick={()=>void loadDownloadHost()}>读取</button></div></label>
        {downloadSnapshot&&<p className="novel-muted">当前设置来源：{downloadSnapshot.site?.source==='site'?'网站独立设置':'全局默认'}。新网站继承全局默认，已有独立设置不会随全局修改。</p>}
        <label>并发线程数<select value={downloadConfig.concurrency} onChange={event=>setDownloadConfig(current=>({...current,concurrency:Number(event.target.value)}))}>{Array.from({length:10},(_,index)=>index+1).map(value=><option key={value} value={value}>{value} 线程</option>)}</select></label>
        <label>请求间隔<select value={downloadConfig.requestIntervalSeconds} onChange={event=>setDownloadConfig(current=>({...current,requestIntervalSeconds:Number(event.target.value)}))}>{Array.from({length:6},(_,index)=>index).map(value=><option key={value} value={value}>{value} 秒</option>)}</select></label>
        <label>最大自动重试次数<select value={downloadConfig.maxRetries} onChange={event=>setDownloadConfig(current=>({...current,maxRetries:Number(event.target.value)}))}>{Array.from({length:11},(_,index)=><option key={index} value={index}>{index} 次</option>)}</select></label>
        <label className="novel-checkbox"><input type="checkbox" checked={downloadConfig.autoRetry} onChange={event=>setDownloadConfig(current=>({...current,autoRetry:event.target.checked}))}/>启用临时错误自动重试</label>
        {downloadSnapshot?.site&&<div className={`novel-alert${downloadSnapshot.site.pausedReason?' novel-alert--warning':''}`} role="status"><strong>网站状态：{downloadSnapshot.site.pausedReason?'已暂停':downloadSnapshot.site.blockedUntil?'按 Retry-After 等待中':'正常'}</strong>{downloadSnapshot.site.pausedReason&&<><p>{downloadSnapshot.site.pausedReason}</p><button className="subtle-action" disabled={schedulerBusy} onClick={()=>void resumeSite()}>确认后恢复该网站</button></>}</div>}
        <div className="novel-actions"><button className="primary-action" disabled={schedulerBusy} onClick={()=>void saveDownloadConfig()}>{schedulerBusy?'保存中…':'保存设置'}</button>{downloadHost.trim()&&<button className="subtle-action" disabled={schedulerBusy||downloadSnapshot?.site?.source!=='site'} onClick={()=>void restoreSiteConfig()}>恢复默认设置</button>}</div>
      </section></div>}
      {pendingParse && metadata && <section className="novel-panel novel-preview">
        <div className="novel-meta"><div><span>书名</span><strong>{metadata.name}</strong></div><div><span>作者</span><strong>{metadata.author}</strong></div><div><span>章节</span><strong>{metadata.chapters.length}</strong></div></div>
        {catalogIntegrity&&<div className={`novel-alert${catalogIntegrity.complete?'':' novel-alert--warning'}`} role="status"><strong>目录检查：已识别 {catalogIntegrity.chapterCount}{catalogIntegrity.expectedChapterCount!==undefined?` / ${catalogIntegrity.expectedChapterCount}`:''} 条，章节已按标题编号排列</strong>{catalogIntegrity.warnings.length>0?<p>{catalogIntegrity.warnings.join(' ')}</p>:<p>章节编号从第1章连续至末章，标题与 URL 映射无冲突。</p>}</div>}
        <h2>整理后的章节目录</h2><ol className="novel-chapter-list">{metadata.chapters.map((chapter) => <li key={chapter.id}>{chapter.title}{chapter.specialType&&chapter.specialType!=='numbered'&&<small className="novel-muted"> · {chapter.specialType==='prologue'?'序章':chapter.specialType==='extra'?'番外':chapter.specialType==='afterword'?'完结/后记':'特殊章节'}</small>}</li>)}</ol>
        <div className="novel-actions"><button className="primary-action" onClick={() => void handleCreate()} disabled={busy||!metadata?.chapters.length}>创建下载任务</button></div>
      </section>}
      <section className="novel-workspace">
        <div className="novel-panel novel-history"><div className="novel-section-heading"><h2>下载任务</h2></div>
          <div className="novel-task-tabs" role="tablist" aria-label="小说下载任务状态">
            <button role="tab" aria-selected={taskTab === 'active'} className={taskTab === 'active' ? 'selected' : ''} onClick={() => changeTaskTab('active')}>正在下载（{activeTasks.length}）</button>
            <button role="tab" aria-selected={taskTab === 'completed'} className={taskTab === 'completed' ? 'selected' : ''} onClick={() => changeTaskTab('completed')}>已完成（{completedTasks.length}）</button>
          </div>
          {visibleTasks.length === 0 ? <p className="novel-muted novel-task-empty">{taskTab === 'active' ? '暂无正在下载的小说。' : '暂无已完成的小说。'}</p> : <ul>{visibleTasks.map((task) => <li key={task.id} className="novel-task-card"><button className={`novel-task-select ${task.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(task.id); setMetadata(null) }}><span>{task.name}</span><small>{statusLabel(task.status)} · {task.chapters.filter((chapter) => chapter.status === 'completed').length}/{task.chapters.length}</small></button><button className="novel-task-delete" title="删除整本小说" aria-label={`删除整本小说：${task.name}`} onClick={(event) => { event.stopPropagation(); setDeleteTarget(task) }}>🗑</button></li>)}</ul>}
        </div>
        <div className="novel-panel novel-task-detail">
          {!selectedTask ? <p className="novel-muted">选择一个任务查看章节和进度。</p> : <>
            <div className="novel-section-heading"><div><h2>{selectedTask.name}</h2><p>{selectedTask.author}</p></div><button className="subtle-action" onClick={() => void openNovelFolder(selectedTask.id)}>打开文件夹</button></div>
            {selectedTask.error && <div className="novel-alert novel-alert--error" role="alert">{selectedTask.error}</div>}
            <div className="novel-progress-label"><span>总计 {total} · 成功 {completed} · 下载中 {downloading} · 等待重试 {retryWaiting} · 失败 {failed}</span><span>{percent}%</span></div><progress max={100} value={percent} aria-label="小说下载进度" />
            {failed>0&&selectedTask.chapters.some((chapter)=>chapter.error?.includes('Cloudflare'))&&<p className="novel-muted">该站点拒绝了普通下载请求。重试仍会被拒绝；可对每个失败章节使用“预览”后在预览窗口保存 HTML，再点“导入 HTML”。BookMind 不会复用验证令牌。</p>}
            <div className="novel-actions">
              <button className="subtle-action" onClick={()=>void openDownloadSettings(new URL(selectedTask.sourceUrl).hostname)}>网站调度设置</button>
              {(selectedTask.status === 'ready' || selectedTask.status === 'paused') && <button className="primary-action" onClick={() => void act(selectedTask.chapters.some((chapter) => chapter.status === 'completed' || chapter.status === 'failed') ? 'resume' : 'start')}>开始下载 / 继续</button>}
              {selectedTask.status === 'downloading' && <><button className="subtle-action" onClick={() => void act('pause')}>暂停</button><button className="danger-action" onClick={() => void act('cancel')}>取消</button></>}
              {failed > 0 && selectedTask.status !== 'downloading' && <button className="subtle-action" onClick={() => void act('retry')}>重试失败章节</button>}
              {canImport && <button className="primary-action" onClick={() => void handleImport()} disabled={busy || importedTaskIds.has(selectedTask.id)}>{importedTaskIds.has(selectedTask.id) ? '已加入书库' : '导入书库'}</button>}
            </div>
            <ol className="novel-chapter-list novel-chapter-list--task">{selectedTask.chapters.map((chapter,index) => <li key={chapter.id}><div className="novel-task-chapter-title"><span>{chapter.title}</span>{chapter.status==='failed'&&<div className="novel-chapter-import-actions"><button className="subtle-action" disabled={busy} onClick={()=>void previewTaskChapter(chapter.url)}>预览</button><button className="subtle-action" disabled={busy} onClick={()=>void importTaskChapter(index)}>导入 HTML</button></div>}</div><small className={`chapter-status chapter-status--${chapter.status}`}>{chapter.status === 'failed' ? `失败：${chapter.error ?? ''}` : chapterStatusLabel(chapter.status)}</small></li>)}</ol>
          </>}
        </div>
      </section>
      {deleteTarget && <div className="novel-modal-backdrop" role="presentation" onMouseDown={event => { if (!deleting && event.target === event.currentTarget) setDeleteTarget(null) }}><section className="novel-panel novel-modal novel-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-novel-title"><div className="novel-section-heading"><h2 id="delete-novel-title">删除整本小说？</h2></div><p>删除后将同时移除该小说的本地 TXT 文件、章节文件、下载任务记录和书库记录，此操作无法撤销。</p><p className="novel-muted">《{deleteTarget.name}》</p><div className="novel-actions"><button className="subtle-action" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button className="danger-action" disabled={deleting} onClick={() => void confirmDeleteTask()}>{deleting ? '正在安全删除…' : '确认删除'}</button></div></section></div>}
    </div>
  </main>
}

function statusLabel(status: NovelTask['status']): string {
  return ({ ready: '待下载', downloading: '下载中', paused: '已暂停', cancelled: '已取消', 'partially-completed':'部分完成', completed: '已完成' })[status]
}
function chapterStatusLabel(status: NovelTask['chapters'][number]['status']): string {
  return ({ pending: '待下载', downloading: '下载中', 'retry-wait':'等待重试', completed: '已完成', failed: '失败' })[status]
}
