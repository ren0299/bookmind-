import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Book } from '../../../shared/types/book.ts'
import type { AiAnalysisAction, AiAnalysisWorkspace } from '../../../shared/types/ai-analysis.ts'
import { controlAiAnalysisJob, createAiAnalysisJob, getAiAnalysisSettings, getAiAnalysisWorkspace, getAiIntegrationStatus, retryAiAnalysisChapter, retryAllFailedAiAnalysisChapters, saveAiAnalysisSettings } from '../../services/library.ts'

interface AIWorkbenchProps { books:Book[]; selectedBookId:string|null; onSelectBook:(bookId:string)=>void }
const statusLabel:Record<string,string>={queued:'等待中',running:'分析中',paused:'已暂停',cancelled:'已取消',completed:'已完成',partial:'部分完成'}

export function AIWorkbench({books,selectedBookId,onSelectBook}:AIWorkbenchProps){
  const [workspace,setWorkspace]=useState<AiAnalysisWorkspace|null>(null)
  const [settings,setSettings]=useState({concurrency:2})
  const [model,setModel]=useState('')
  const [provider,setProvider]=useState('')
  const [hasApiKey,setHasApiKey]=useState(false)
  const [rangeValues,setRangeValues]=useState<{bookId:string;start:string;end:string|null}>({bookId:'',start:'',end:null})
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState<string|null>(null)
  const [notice,setNotice]=useState<string|null>(null)
  const currentBook=useMemo(()=>books.find(book=>book.id===selectedBookId)??books.find(book=>book.type==='txt'||book.path.toLowerCase().endsWith('.txt'))??books[0],[books,selectedBookId])

  const refresh=useCallback(async()=>{
    if(!currentBook){setWorkspace(null);return}
    try{setWorkspace(await getAiAnalysisWorkspace(currentBook.id))}catch(cause){setError(cause instanceof Error?cause.message:'读取 AI 工作台失败。')}
  },[currentBook])

  useEffect(()=>{let active=true;void Promise.all([getAiAnalysisSettings(),getAiIntegrationStatus()]).then(([next,status])=>{if(!active)return;setSettings(next);setProvider(status.provider);setModel(status.model);setHasApiKey(status.hasApiKey)}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'读取 AI 配置失败。')});return()=>{active=false}},[])
  useEffect(()=>{let active=true;const load=async()=>{if(!currentBook){if(active)setWorkspace(null);return}try{const next=await getAiAnalysisWorkspace(currentBook.id);if(active)setWorkspace(next)}catch(cause){if(active)setError(cause instanceof Error?cause.message:'读取 AI 工作台失败。')}};void load();const timer=window.setInterval(()=>void load(),1500);return()=>{active=false;window.clearInterval(timer)}},[currentBook])

  const latestJob=workspace?.jobs[0]??null
  const newestFirstSummaries=useMemo(()=>workspace?.summaries??[],[workspace?.summaries])
  const percent=latestJob?.totalChapters?Math.round(latestJob.analyzedChapters/latestJob.totalChapters*100):0
  const active=latestJob?.status==='queued'||latestJob?.status==='running'
  const maxChapterNumber=useMemo(()=>{
    if(!workspace?.book.supported||workspace.book.id!==currentBook?.id)return null
    const numbers=workspace.chapters.map(chapter=>chapter.chapterNumber).filter((number):number is number=>number!==null&&Number.isInteger(number)&&number>0)
    return numbers.length?Math.max(...numbers):null
  },[workspace,currentBook?.id])
  const startNumber=rangeValues.bookId===currentBook?.id?rangeValues.start:''
  const endNumber=rangeValues.bookId===currentBook?.id&&rangeValues.end!==null?rangeValues.end:(maxChapterNumber===null?'':String(maxChapterNumber))

  const rangeError=useMemo(()=>{
    if(!workspace?.book.supported||maxChapterNumber===null)return null
    const start=startNumber===''?null:Number(startNumber),end=endNumber===''?null:Number(endNumber)
    if(start!==null&&(!Number.isInteger(start)||start<1))return '开始章节不能小于 1。'
    if(start!==null&&start>maxChapterNumber)return `开始章节不能超过本书最后一章（第 ${maxChapterNumber} 章）。`
    if(start!==null&&!workspace.chapters.some(chapter=>chapter.chapterNumber===start))return `目录中没有识别到第 ${start} 章，请检查章节目录。`
    if(end!==null&&(!Number.isInteger(end)||end<1))return '结束章节不能小于 1。'
    if(end!==null&&end>maxChapterNumber)return `结束章节不能超过本书最后一章（第 ${maxChapterNumber} 章）。`
    if(end!==null&&!workspace.chapters.some(chapter=>chapter.chapterNumber===end))return `目录中没有识别到第 ${end} 章，请检查章节目录。`
    if(start!==null&&end!==null&&end<start)return '结束章节不能小于开始章节。'
    return null
  },[workspace,maxChapterNumber,startNumber,endNumber])

  async function updateConcurrency(value:number){
    setSettings({concurrency:value})
    try{await saveAiAnalysisSettings({concurrency:value})}catch(cause){setError(cause instanceof Error?cause.message:'保存 AI 并发设置失败。')}
  }
  async function start(){
    if(!workspace?.book.supported)return
    setBusy(true);setError(null);setNotice(null)
    try{await createAiAnalysisJob({bookId:workspace.book.id,...(startNumber?{startChapterNumber:Number(startNumber)}:{}),...(endNumber?{endChapterNumber:Number(endNumber)}:{})});await refresh();setNotice('AI 分析任务已加入队列。')}
    catch(cause){setError(cause instanceof Error?cause.message:'无法创建 AI 分析任务。')}
    finally{setBusy(false)}
  }
  async function act(action:AiAnalysisAction){
    if(!latestJob)return
    setBusy(true);setError(null)
    try{await controlAiAnalysisJob(latestJob.id,action);await refresh()}
    catch(cause){setError(cause instanceof Error?cause.message:'分析任务操作失败。')}
    finally{setBusy(false)}
  }
  async function retryChapter(chapterId:string){
    if(!latestJob)return
    setBusy(true);setError(null)
    try{await retryAiAnalysisChapter(latestJob.id,chapterId);await refresh()}
    catch(cause){setError(cause instanceof Error?cause.message:'章节重试失败。')}
    finally{setBusy(false)}
  }
  async function retryFailed(){
    if(!latestJob)return
    setBusy(true);setError(null)
    try{await retryAllFailedAiAnalysisChapters(latestJob.id);await refresh()}
    catch(cause){setError(cause instanceof Error?cause.message:'失败章节重试失败。')}
    finally{setBusy(false)}
  }

  return <main className="ai-workbench-page"><div className="ai-workbench-shell">
    <header className="novel-heading"><div><p className="novel-eyebrow">BOOKMIND AI WORKSPACE</p><h1>AI 小说分析工作台</h1><p>逐章生成并保存摘要，随时暂停并从未完成章节继续。</p></div></header>
    {!books.length?<section className="novel-panel"><p className="novel-muted">书库为空。先导入一部 BookMind 下载并完成的 TXT 小说。</p></section>:<>
      <section className="novel-panel ai-workbench-setup">
        <label>选择小说<select value={currentBook?.id??''} onChange={event=>{setRangeValues({bookId:event.target.value,start:'',end:null});onSelectBook(event.target.value)}}>{books.map(book=><option key={book.id} value={book.id}>{book.name} · {(book.type==='txt'||book.path.toLowerCase().endsWith('.txt'))?'TXT':'PDF'}</option>)}</select></label>
        <p className="novel-muted">当前 AI 服务：{provider==='gemini'?'Google Gemini':provider||'未配置'} · 模型：{model||'未配置'} · {hasApiKey?'API Key 已保存':'尚未保存 API Key'}</p>
        <label>AI 并发<select value={settings.concurrency} onChange={event=>void updateConcurrency(Number(event.target.value))}>{Array.from({length:10},(_,index)=>index+1).map(value=><option key={value} value={value}>{value} 线程</option>)}</select></label>
      </section>
      {workspace&&<>
        {!workspace.book.supported?<section className="novel-alert novel-alert--warning" role="status"><strong>暂不能分析这本书</strong><p>{workspace.book.unsupportedReason}</p><p>目前复用 BookMind 下载任务中的章节文件和索引；普通 PDF 或没有章节索引的 TXT 暂不支持。</p></section>:<>
          <section className="novel-panel ai-analysis-panel">
            <div className="novel-section-heading"><div><h2>{workspace.book.name}</h2><p>{workspace.book.author??'未知作者'} · {workspace.book.chapterCount} 章</p></div>{latestJob&&<span className={`ai-status ai-status--${latestJob.status}`}>{statusLabel[latestJob.status]??latestJob.status}</span>}</div>
            {!latestJob||latestJob.status==='cancelled'||latestJob.status==='completed'?<>
              <div className="ai-analysis-start"><label>从第几章开始<input inputMode="numeric" type="number" min="1" max={maxChapterNumber??undefined} value={startNumber} onChange={event=>setRangeValues({bookId:workspace.book.id,start:event.target.value,end:rangeValues.bookId===workspace.book.id?rangeValues.end:null})} placeholder="默认从头开始"/></label><label>分析到第几章<input inputMode="numeric" type="number" min="1" max={maxChapterNumber??undefined} value={endNumber} onChange={event=>setRangeValues({bookId:workspace.book.id,start:rangeValues.bookId===workspace.book.id?rangeValues.start:'',end:event.target.value})} placeholder={maxChapterNumber===null?'先完成章节解析':`1 - ${maxChapterNumber}（本书最后一章）`}/></label><button className="primary-action" disabled={busy||!hasApiKey||provider!=='gemini'||!workspace.book.supported||maxChapterNumber===null||!!rangeError} onClick={()=>void start()}>{busy?'正在提交…':latestJob?.status==='completed'?'分析缺少摘要的章节':'开始分析'}</button></div>
              <p className="ai-range-hint">{maxChapterNumber===null?'尚未解析出可用的章节编号，请先完成章节解析。':`本书共 ${workspace.chapters.length} 章 · 最后一章：第 ${maxChapterNumber} 章`}</p>
              {rangeError&&<p className="ai-range-error" role="alert">{rangeError}</p>}
            </>:null}
            {latestJob&&<>
              <div className="ai-progress-stats"><span>总章数 <b>{latestJob.totalChapters}</b></span><span>已分析 <b>{latestJob.analyzedChapters}</b></span><span>失败 <b>{latestJob.failedChapters}</b></span><span>剩余 <b>{latestJob.pendingChapters}</b></span><strong>{percent}%</strong></div>
              <progress className="ai-progress" max={latestJob.totalChapters||1} value={latestJob.analyzedChapters}/>
              <p className="novel-muted">当前章节：{latestJob.currentChapterTitle??(active?'等待可用线程':'暂无')} · 模型：{latestJob.model} · 预计剩余章节数：{Math.max(0,latestJob.totalChapters-latestJob.analyzedChapters)}</p>
              {latestJob.error&&<div className="novel-alert novel-alert--warning" role="status">{latestJob.error}</div>}
              <div className="novel-actions">
                {active&&<button className="subtle-action" disabled={busy} onClick={()=>void act('pause')}>暂停分析</button>}
                {latestJob.status==='paused'&&<button className="primary-action" disabled={busy} onClick={()=>void act('resume')}>继续分析</button>}
                {latestJob.status==='partial'&&<><button className="primary-action" disabled={busy} onClick={()=>void act('resume')}>继续分析</button><button className="subtle-action" disabled={busy} onClick={()=>void retryFailed()}>重试全部失败章节</button></>}
                {(active||latestJob.status==='paused'||latestJob.status==='partial')&&<button className="danger-action" disabled={busy} onClick={()=>void act('cancel')}>取消任务</button>}
              </div>
            </>}
          </section>
          {workspace.jobs.length>1&&<details className="ai-job-history"><summary>分析任务历史（{workspace.jobs.length}）</summary><ul>{workspace.jobs.map(job=><li key={job.id}>{statusLabel[job.status]} · {job.analyzedChapters}/{job.totalChapters} · {new Date(job.createdAt).toLocaleString()}</li>)}</ul></details>}
          <section className="novel-panel ai-summaries"><div className="novel-section-heading"><h2>章节摘要</h2><span>{newestFirstSummaries.filter(item=>item.status==='completed').length} 条已保存</span></div>
            {!newestFirstSummaries.length?<p className="novel-muted">还没有摘要。开始分析后，每章结果会立即保存在本机。</p>:<div className="ai-summary-list">{newestFirstSummaries.map(item=><article key={`${item.bookId}:${item.chapterId}`} className="ai-summary-card"><div className="ai-summary-heading"><h3>{item.chapterTitle}</h3><small>{item.status==='completed'?`${item.model} · ${item.analyzedAt?new Date(item.analyzedAt).toLocaleString():'已保存'}`:'分析失败'}</small></div>{item.status==='completed'?<><p>{item.summary}</p>{item.keyEvents.length>0&&<div><strong>关键事件</strong><ul>{item.keyEvents.map((event,index)=><li key={index}>{event}</li>)}</ul></div>}{item.characters.length>0&&<p><strong>人物：</strong>{item.characters.join('、')}</p>}{item.characterChanges.length>0&&<div><strong>人物变化</strong><ul>{item.characterChanges.map((change,index)=><li key={index}>{change.character}：{change.change}</li>)}</ul></div>}{item.importantFacts.length>0&&<div><strong>重要事实</strong><ul>{item.importantFacts.map((fact,index)=><li key={index}>{fact}</li>)}</ul></div>}{item.clues.length>0&&<div><strong>线索</strong><ul>{item.clues.map((clue,index)=><li key={index}>{clue}</li>)}</ul></div>}{item.totalTokens!==null&&<small>Token 使用量：{item.totalTokens}{item.promptTokens!==null&&item.candidateTokens!==null?`（输入 ${item.promptTokens} / 输出 ${item.candidateTokens}）`:''}</small>}</>:<><p className="reader-status reader-status--error">{item.error??'该章节分析失败。'}</p>{latestJob?.failedChapterIds.includes(item.chapterId)&&<button className="subtle-action" disabled={busy||active} onClick={()=>void retryChapter(item.chapterId)}>重试本章</button>}</>}</article>)}</div>}
          </section>
        </>}
      </>}
    </>}
    {notice&&<div className="novel-alert" role="status">{notice}</div>}{error&&<div className="novel-alert novel-alert--warning" role="alert">{error}</div>}
  </div></main>
}
