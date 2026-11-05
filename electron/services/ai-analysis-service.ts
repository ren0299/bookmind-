import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { app } from 'electron'
import type { AiAnalysisAction, AiAnalysisBook, AiAnalysisJob, AiAnalysisSettings, AiAnalysisWorkspace, AiChapterSummary, CreateAiAnalysisJobInput } from '../../shared/types/ai-analysis.ts'
import { generateGeminiChapterAnalysis, getAiIntegrationStatus } from './novel/ai-adapter-service.ts'
import { getNovelAiAnalysisSource, readNovelAiAnalysisChapter } from './novel/novel-service.ts'
import { loadLibraryState } from './storage/library-store.ts'
import { AiAnalysisStore } from './storage/ai-analysis-store.ts'

type JobChapterRow={job_id:string;chapter_id:string;chapter_number:number|null;chapter_title:string;position:number;status:string;attempts:number;error:string|null;book_id:string;book_name:string;novel_task_id:string;model:string;concurrency:number}
type SummaryRow={book_id:string;chapter_id:string;chapter_number:number|null;chapter_position:number;chapter_title:string;summary:string|null;key_events_json:string;characters_json:string;character_changes_json:string;important_facts_json:string;clues_json:string;model:string;analyzed_at:string|null;status:string;prompt_tokens:number|null;candidate_tokens:number|null;total_tokens:number|null;error:string|null}

let database:AiAnalysisStore|null=null
let initialization:Promise<void>|null=null
let pumpPromise:Promise<void>|null=null
let shuttingDown=false
const pausedJobs=new Set<string>()
const cancelledJobs=new Set<string>()
const CHAPTER_INPUT_LIMIT=120_000
const databasePath=()=>path.join(app.getPath('userData'),'ai-analysis.sqlite')
const db=()=>{if(!database)throw new Error('AI 分析数据库尚未初始化。');return database.database}

export async function initializeAiAnalysisService():Promise<void>{
  if(initialization)return initialization
  initialization=(async()=>{
    shuttingDown=false
    database=new AiAnalysisStore(databasePath())
    database.recoverInterruptedJobs()
    void schedulePump()
  })()
  return initialization
}

export function shutdownAiAnalysisService():void{
  if(!database)return
  shuttingDown=true
  try{db().exec("UPDATE ai_analysis_job_chapters SET status='pending',error=NULL WHERE status='running'; UPDATE ai_analysis_jobs SET status='queued',current_chapter_id=NULL,updated_at=datetime('now') WHERE status='running';")}catch{/* process exit recovery also repairs running rows on next launch */}
  database.close();database=null
}

async function ready():Promise<void>{await initializeAiAnalysisService()}

function json(value:string|undefined|null):unknown[]{try{const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[]}catch{return []}}

function mapSummary(row:SummaryRow):AiChapterSummary{return {bookId:row.book_id,chapterId:row.chapter_id,chapterNumber:row.chapter_number,position:row.chapter_position,chapterTitle:row.chapter_title,summary:row.summary,keyEvents:json(row.key_events_json) as string[],characters:json(row.characters_json) as string[],characterChanges:json(row.character_changes_json) as Array<{character:string;change:string}>,importantFacts:json(row.important_facts_json) as string[],clues:json(row.clues_json) as string[],model:row.model,analyzedAt:row.analyzed_at,status:row.status as AiChapterSummary['status'],promptTokens:row.prompt_tokens,candidateTokens:row.candidate_tokens,totalTokens:row.total_tokens,error:row.error}}

function summariesForBook(bookId:string):AiChapterSummary[]{
  const rows=db().prepare('SELECT * FROM chapter_summaries WHERE book_id=? ORDER BY chapter_position, chapter_number').all(bookId) as SummaryRow[]
  return rows.map(mapSummary)
}

function jobsForBook(bookId:string):AiAnalysisJob[]{
  const rows=db().prepare(`SELECT j.*,
    COUNT(c.chapter_id) AS total_chapters,
    COALESCE(SUM(CASE WHEN c.status='completed' THEN 1 ELSE 0 END),0) AS analyzed_chapters,
    COALESCE(SUM(CASE WHEN c.status='failed' THEN 1 ELSE 0 END),0) AS failed_chapters,
    COALESCE(SUM(CASE WHEN c.status IN ('pending','running') THEN 1 ELSE 0 END),0) AS pending_chapters,
    (SELECT chapter_id FROM ai_analysis_job_chapters WHERE job_id=j.id AND status='running' ORDER BY position LIMIT 1) AS active_chapter_id,
    (SELECT chapter_title FROM ai_analysis_job_chapters WHERE job_id=j.id AND status='running' ORDER BY position LIMIT 1) AS active_chapter_title
    FROM ai_analysis_jobs j LEFT JOIN ai_analysis_job_chapters c ON c.job_id=j.id
    WHERE j.book_id=? GROUP BY j.id ORDER BY j.created_at DESC`).all(bookId) as Array<Record<string,unknown>>
  return rows.map(row=>({id:String(row.id),bookId:String(row.book_id),bookName:String(row.book_name),novelTaskId:String(row.novel_task_id),status:row.status as AiAnalysisJob['status'],model:String(row.model),concurrency:Number(row.concurrency),totalChapters:Number(row.total_chapters),analyzedChapters:Number(row.analyzed_chapters),failedChapters:Number(row.failed_chapters),pendingChapters:Number(row.pending_chapters),failedChapterIds:(db().prepare("SELECT chapter_id FROM ai_analysis_job_chapters WHERE job_id=? AND status='failed' ORDER BY position").all(String(row.id)) as Array<{chapter_id:string}>).map(item=>item.chapter_id),currentChapterId:typeof row.active_chapter_id==='string'?row.active_chapter_id:null,currentChapterTitle:typeof row.active_chapter_title==='string'?row.active_chapter_title:null,startChapterNumber:typeof row.start_chapter_number==='number'?row.start_chapter_number:null,endChapterNumber:typeof row.end_chapter_number==='number'?row.end_chapter_number:null,error:typeof row.error==='string'?row.error:null,createdAt:String(row.created_at),updatedAt:String(row.updated_at)}))
}

export async function getAiAnalysisSettings():Promise<AiAnalysisSettings>{await ready();return database!.getSettings()}
export async function saveAiAnalysisSettings(settings:AiAnalysisSettings):Promise<AiAnalysisSettings>{
  await ready()
  if(!Number.isInteger(settings.concurrency)||settings.concurrency<1||settings.concurrency>10)throw new Error('AI 并发数必须为 1～10。')
  database!.saveSettings(settings)
  void schedulePump()
  return database!.getSettings()
}

export async function getAiAnalysisWorkspace(bookId:string):Promise<AiAnalysisWorkspace>{
  await ready()
  const library=await loadLibraryState(),book=library.books.find(item=>item.id===bookId)
  if(!book)throw new Error('当前书库中找不到这本书。')
  let chapters:AiAnalysisWorkspace['chapters']=[],supported=false,unsupportedReason:string|undefined
  try{
    const source=await getNovelAiAnalysisSource(bookId)
    chapters=source.chapters
    supported=true
  }catch(error){unsupportedReason=error instanceof Error?error.message:'无法读取小说章节。'}
  const analysisBook:AiAnalysisBook={id:book.id,name:book.name,author:book.author,type:book.type,novelTaskId:book.novelTaskId,chapterCount:chapters.length,supported,unsupportedReason}
  return {book:analysisBook,chapters,jobs:jobsForBook(bookId),summaries:summariesForBook(bookId)}
}

export async function createAiAnalysisJob(input:CreateAiAnalysisJobInput):Promise<AiAnalysisJob>{
  await ready()
  const source=await getNovelAiAnalysisSource(input.bookId)
  const settings=database!.getSettings(),integration=await getAiIntegrationStatus()
  if(integration.provider!=='gemini')throw new Error('请先在 API 接口设置中选择 Google Gemini。')
  if(!integration.hasApiKey)throw new Error('请先在 API 接口设置中保存 Gemini API Key。')
  const active=db().prepare("SELECT id FROM ai_analysis_jobs WHERE book_id=? AND status IN ('queued','running','paused') LIMIT 1").get(input.bookId) as {id:string}|undefined
  if(active)throw new Error('这本小说已有未完成的 AI 分析任务，请先继续或取消该任务。')
  const chapters=source.chapters
  let startIndex=0,endIndex=chapters.length-1
  if(input.startChapterNumber!==undefined){if(!Number.isInteger(input.startChapterNumber)||input.startChapterNumber<1)throw new Error('起始章节编号无效。');startIndex=chapters.findIndex(chapter=>chapter.chapterNumber===input.startChapterNumber);if(startIndex<0)throw new Error(`目录中找不到第 ${input.startChapterNumber} 章。`)}
  if(input.endChapterNumber!==undefined){if(!Number.isInteger(input.endChapterNumber)||input.endChapterNumber<1)throw new Error('结束章节编号无效。');endIndex=chapters.findLastIndex(chapter=>chapter.chapterNumber===input.endChapterNumber);if(endIndex<0)throw new Error(`目录中找不到第 ${input.endChapterNumber} 章。`)}
  if(startIndex>endIndex)throw new Error('起始章节必须排在结束章节之前。')
  const selected=chapters.slice(startIndex,endIndex+1)
  if(!selected.length)throw new Error('选择范围内没有可分析的章节。')
  const id=randomUUID(),now=new Date().toISOString(),connection=db()
  connection.exec('BEGIN IMMEDIATE')
  try{
    connection.prepare(`INSERT INTO ai_analysis_jobs(id,book_id,book_name,novel_task_id,status,model,concurrency,start_chapter_number,end_chapter_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,input.bookId,source.bookName,source.taskId,'queued',integration.model,settings.concurrency,input.startChapterNumber??null,input.endChapterNumber??null,now,now)
    const insert=connection.prepare('INSERT INTO ai_analysis_job_chapters(job_id,chapter_id,chapter_number,chapter_title,position,status,updated_at) VALUES(?,?,?,?,?,?,?)')
    const summary=connection.prepare("SELECT status FROM chapter_summaries WHERE book_id=? AND chapter_id=? AND status='completed'")
    for(const chapter of selected){const existing=summary.get(input.bookId,chapter.id) as {status:string}|undefined;insert.run(id,chapter.id,chapter.chapterNumber,chapter.title,chapter.position,existing?'completed':'pending',now)}
    connection.exec('COMMIT')
  }catch(error){connection.exec('ROLLBACK');throw error}
  void schedulePump()
  const job=jobsForBook(input.bookId).find(item=>item.id===id)
  if(!job)throw new Error('AI 分析任务已保存，但无法读取任务状态。')
  return job
}

export async function controlAiAnalysisJob(id:string,action:AiAnalysisAction):Promise<AiAnalysisJob>{
  await ready()
  const job=db().prepare('SELECT book_id,status FROM ai_analysis_jobs WHERE id=?').get(id) as {book_id:string;status:string}|undefined
  if(!job)throw new Error('找不到该 AI 分析任务。')
  const now=new Date().toISOString()
  if(action==='pause'){
    pausedJobs.add(id)
    db().prepare("UPDATE ai_analysis_jobs SET status='paused',error=NULL,updated_at=? WHERE id=? AND status IN ('queued','running')").run(now,id)
  }else if(action==='resume'){
    if(job.status==='cancelled')throw new Error('已取消的分析任务不能继续；请新建分析任务。')
    pausedJobs.delete(id);db().prepare("UPDATE ai_analysis_jobs SET status='queued',error=NULL,updated_at=? WHERE id=? AND status IN ('paused','partial')").run(now,id)
    db().prepare("UPDATE ai_analysis_job_chapters SET status='pending',error=NULL,updated_at=? WHERE job_id=? AND status='failed'").run(now,id)
    void schedulePump()
  }else{
    cancelledJobs.add(id);pausedJobs.delete(id)
    db().prepare("UPDATE ai_analysis_jobs SET status='cancelled',current_chapter_id=NULL,error=NULL,updated_at=? WHERE id=? AND status NOT IN ('completed','cancelled')").run(now,id)
    db().prepare("UPDATE ai_analysis_job_chapters SET status='cancelled',error=NULL,updated_at=? WHERE job_id=? AND status IN ('pending','running','failed')").run(now,id)
  }
  const result=jobsForBook(job.book_id).find(item=>item.id===id)
  if(!result)throw new Error('读取分析任务失败。')
  return result
}

export async function retryAiAnalysisChapter(jobId:string,chapterId:string):Promise<AiAnalysisJob>{
  await ready()
  const job=db().prepare('SELECT book_id,status FROM ai_analysis_jobs WHERE id=?').get(jobId) as {book_id:string;status:string}|undefined
  if(!job)throw new Error('找不到该 AI 分析任务。')
  if(job.status==='cancelled')throw new Error('已取消的分析任务不能重试。')
  const chapter=db().prepare("SELECT chapter_title FROM ai_analysis_job_chapters WHERE job_id=? AND chapter_id=? AND status='failed'").get(jobId,chapterId) as {chapter_title:string}|undefined
  if(!chapter)throw new Error('该章节当前不是失败状态。')
  const now=new Date().toISOString()
  db().prepare("UPDATE ai_analysis_job_chapters SET status='pending',error=NULL,updated_at=? WHERE job_id=? AND chapter_id=?").run(now,jobId,chapterId)
  db().prepare("UPDATE chapter_summaries SET summary=NULL,key_events_json='[]',characters_json='[]',character_changes_json='[]',important_facts_json='[]',clues_json='[]',status='pending',analyzed_at=NULL,error=NULL WHERE book_id=? AND chapter_id=?").run(job.book_id,chapterId)
  pausedJobs.delete(jobId);db().prepare("UPDATE ai_analysis_jobs SET status='queued',error=NULL,updated_at=? WHERE id=?").run(now,jobId)
  void schedulePump()
  const result=jobsForBook(job.book_id).find(item=>item.id===jobId)
  if(!result)throw new Error('读取分析任务失败。')
  return result
}

export async function retryAllFailedAiAnalysisChapters(jobId:string):Promise<AiAnalysisJob>{
  await ready()
  const job=db().prepare('SELECT book_id,status FROM ai_analysis_jobs WHERE id=?').get(jobId) as {book_id:string;status:string}|undefined
  if(!job)throw new Error('找不到该 AI 分析任务。')
  if(job.status==='cancelled')throw new Error('已取消的分析任务不能重试。')
  const failed=db().prepare("SELECT chapter_id FROM ai_analysis_job_chapters WHERE job_id=? AND status='failed'").all(jobId) as Array<{chapter_id:string}>
  if(!failed.length)throw new Error('当前任务没有失败章节。')
  const now=new Date().toISOString()
  for(const chapter of failed){db().prepare("UPDATE ai_analysis_job_chapters SET status='pending',error=NULL,updated_at=? WHERE job_id=? AND chapter_id=?").run(now,jobId,chapter.chapter_id);db().prepare("UPDATE chapter_summaries SET summary=NULL,key_events_json='[]',characters_json='[]',character_changes_json='[]',important_facts_json='[]',clues_json='[]',status='pending',analyzed_at=NULL,error=NULL WHERE book_id=? AND chapter_id=?").run(job.book_id,chapter.chapter_id)}
  pausedJobs.delete(jobId);db().prepare("UPDATE ai_analysis_jobs SET status='queued',error=NULL,updated_at=? WHERE id=?").run(now,jobId);void schedulePump()
  const result=jobsForBook(job.book_id).find(item=>item.id===jobId);if(!result)throw new Error('读取分析任务失败。');return result
}

function usageFromError(error:unknown):{promptTokens:number|null;candidateTokens:number|null;totalTokens:number|null}{
  if(error&&typeof error==='object'&&'tokenUsage'in error)return (error as {tokenUsage:{promptTokens:number|null;candidateTokens:number|null;totalTokens:number|null}}).tokenUsage
  return {promptTokens:null,candidateTokens:null,totalTokens:null}
}

async function runChapter(row:JobChapterRow):Promise<void>{
  const now=new Date().toISOString(),connection=db()
  const cached=connection.prepare("SELECT status FROM chapter_summaries WHERE book_id=? AND chapter_id=? AND status='completed'").get(row.book_id,row.chapter_id)
  if(cached){connection.prepare("UPDATE ai_analysis_job_chapters SET status='completed',error=NULL,updated_at=? WHERE job_id=? AND chapter_id=?").run(now,row.job_id,row.chapter_id);return}
  connection.prepare("UPDATE ai_analysis_jobs SET status='running',current_chapter_id=?,error=NULL,updated_at=? WHERE id=? AND status IN ('queued','running')").run(row.chapter_id,now,row.job_id)
  connection.prepare("UPDATE ai_analysis_job_chapters SET status='running',attempts=attempts+1,error=NULL,updated_at=? WHERE job_id=? AND chapter_id=? AND status='pending'").run(now,row.job_id,row.chapter_id)
  try{
    const chapter=await readNovelAiAnalysisChapter(row.book_id,row.chapter_id)
    if(shuttingDown||pausedJobs.has(row.job_id)){connection.prepare("UPDATE ai_analysis_job_chapters SET status='pending',updated_at=? WHERE job_id=? AND chapter_id=? AND status='running'").run(new Date().toISOString(),row.job_id,row.chapter_id);return}
    if(chapter.content.length>CHAPTER_INPUT_LIMIT)throw new Error(`章节正文超过 ${CHAPTER_INPUT_LIMIT.toLocaleString()} 个字符，为控制上下文和费用已跳过。`)
    const generated=await generateGeminiChapterAnalysis({model:row.model,chapterNumber:row.chapter_number,chapterTitle:row.chapter_title,content:chapter.content})
    if(shuttingDown||cancelledJobs.has(row.job_id))return
    const completedAt=new Date().toISOString()
    connection.exec('BEGIN IMMEDIATE')
    try{
      connection.prepare(`INSERT INTO chapter_summaries(id,book_id,chapter_id,chapter_number,chapter_title,chapter_position,summary,key_events_json,characters_json,character_changes_json,important_facts_json,clues_json,model,analyzed_at,status,prompt_tokens,candidate_tokens,total_tokens,error)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'completed',?,?,?,NULL)
        ON CONFLICT(book_id,chapter_id) DO UPDATE SET chapter_number=excluded.chapter_number,chapter_title=excluded.chapter_title,chapter_position=excluded.chapter_position,summary=excluded.summary,key_events_json=excluded.key_events_json,characters_json=excluded.characters_json,character_changes_json=excluded.character_changes_json,important_facts_json=excluded.important_facts_json,clues_json=excluded.clues_json,model=excluded.model,analyzed_at=excluded.analyzed_at,status='completed',prompt_tokens=excluded.prompt_tokens,candidate_tokens=excluded.candidate_tokens,total_tokens=excluded.total_tokens,error=NULL`).run(randomUUID(),row.book_id,row.chapter_id,row.chapter_number,row.chapter_title,row.position,generated.analysis.summary,JSON.stringify(generated.analysis.key_events),JSON.stringify(generated.analysis.characters),JSON.stringify(generated.analysis.character_changes),JSON.stringify(generated.analysis.important_facts),JSON.stringify(generated.analysis.clues),row.model,completedAt,generated.tokenUsage.promptTokens,generated.tokenUsage.candidateTokens,generated.tokenUsage.totalTokens)
      connection.prepare("UPDATE ai_analysis_job_chapters SET status='completed',error=NULL,updated_at=? WHERE job_id=? AND chapter_id=?").run(completedAt,row.job_id,row.chapter_id)
      connection.exec('COMMIT')
    }catch(error){connection.exec('ROLLBACK');throw error}
  }catch(error){
    if(shuttingDown||cancelledJobs.has(row.job_id))return
    const message=error instanceof Error?error.message:'章节分析失败。',usage=usageFromError(error),failedAt=new Date().toISOString()
    connection.prepare(`INSERT INTO chapter_summaries(id,book_id,chapter_id,chapter_number,chapter_title,chapter_position,model,status,prompt_tokens,candidate_tokens,total_tokens,error)
      VALUES(?,?,?,?,?,?,?,'failed',?,?,?,?)
      ON CONFLICT(book_id,chapter_id) DO UPDATE SET chapter_number=excluded.chapter_number,chapter_title=excluded.chapter_title,chapter_position=excluded.chapter_position,model=excluded.model,status='failed',prompt_tokens=excluded.prompt_tokens,candidate_tokens=excluded.candidate_tokens,total_tokens=excluded.total_tokens,error=excluded.error`).run(randomUUID(),row.book_id,row.chapter_id,row.chapter_number,row.chapter_title,row.position,row.model,usage.promptTokens,usage.candidateTokens,usage.totalTokens,message.slice(0,500))
    connection.prepare("UPDATE ai_analysis_job_chapters SET status='failed',error=?,updated_at=? WHERE job_id=? AND chapter_id=?").run(message.slice(0,500),failedAt,row.job_id,row.chapter_id)
  }finally{
    if(!shuttingDown)connection.prepare('UPDATE ai_analysis_jobs SET current_chapter_id=CASE WHEN current_chapter_id=? THEN NULL ELSE current_chapter_id END,updated_at=? WHERE id=?').run(row.chapter_id,new Date().toISOString(),row.job_id)
  }
}

function nextPendingChapter():JobChapterRow|undefined{
  return db().prepare(`SELECT c.*,j.book_id,j.book_name,j.novel_task_id,j.model,j.concurrency FROM ai_analysis_job_chapters c JOIN ai_analysis_jobs j ON j.id=c.job_id WHERE c.status='pending' AND j.status IN ('queued','running') ORDER BY j.created_at,c.position LIMIT 1`).get() as JobChapterRow|undefined
}

function settleJobs():void{
  const rows=db().prepare("SELECT id FROM ai_analysis_jobs WHERE status IN ('queued','running')").all() as Array<{id:string}>
  const update=db().prepare(`UPDATE ai_analysis_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM ai_analysis_job_chapters WHERE job_id=? AND status='failed') THEN 'partial' ELSE 'completed' END,current_chapter_id=NULL,updated_at=? WHERE id=? AND status IN ('queued','running') AND NOT EXISTS(SELECT 1 FROM ai_analysis_job_chapters WHERE job_id=? AND status IN ('pending','running'))`)
  const now=new Date().toISOString()
  for(const {id} of rows)update.run(id,now,id,id)
}

async function worker():Promise<void>{
  while(!shuttingDown&&database){
    const chapter=nextPendingChapter()
    if(!chapter)return
    await runChapter(chapter)
  }
}

function hasPendingWork():boolean{return Boolean(db().prepare("SELECT 1 FROM ai_analysis_job_chapters c JOIN ai_analysis_jobs j ON j.id=c.job_id WHERE c.status='pending' AND j.status IN ('queued','running') LIMIT 1").get())}

function schedulePump():Promise<void>{
  if(!database)return Promise.resolve()
  if(pumpPromise)return pumpPromise
  pumpPromise=(async()=>{
    const integration=await getAiIntegrationStatus()
    if(integration.provider!=='gemini'||!integration.hasApiKey){
      db().prepare("UPDATE ai_analysis_jobs SET status='paused',error=?,updated_at=? WHERE status IN ('queued','running')").run(integration.provider!=='gemini'?'请选择 Google Gemini 后继续分析。':'请配置 Gemini API Key 后继续分析。',new Date().toISOString())
      db().prepare("UPDATE ai_analysis_job_chapters SET status='pending',updated_at=? WHERE status='running'").run(new Date().toISOString())
      return
    }
    const settings=database!.getSettings()
    await Promise.all(Array.from({length:settings.concurrency},()=>worker()))
    settleJobs()
  })().catch(error=>{
    if(!database||shuttingDown)return
    const message=error instanceof Error?error.message:'AI 分析队列发生内部错误。'
    db().prepare("UPDATE ai_analysis_jobs SET status='paused',error=?,updated_at=? WHERE status IN ('queued','running')").run(message.slice(0,500),new Date().toISOString())
  }).finally(()=>{
    pumpPromise=null
    if(!shuttingDown&&database&&hasPendingWork())void schedulePump()
  })
  return pumpPromise
}
