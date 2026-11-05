import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AiAnalysisStore } from '../electron/services/storage/ai-analysis-store.ts'
import { parseGeminiChapterAnalysis } from '../shared/lib/ai-chapter-schema.ts'

test('creates SQLite analysis tables, persists settings, and prevents duplicate book/chapter summaries', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'bookmind-ai-analysis-'))
  const file=path.join(root,'analysis.sqlite')
  try{
    let store=new AiAnalysisStore(file)
    assert.equal(store.getSettings().concurrency,2)
    store.saveSettings({concurrency:7})
    const tables=store.database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name)
    assert.ok(tables.includes('ai_analysis_jobs'))
    assert.ok(tables.includes('chapter_summaries'))
    store.database.prepare("INSERT INTO ai_analysis_jobs(id,book_id,book_name,novel_task_id,status,model,concurrency,created_at,updated_at) VALUES('job','book','Book','task','queued','gemini-2.5-flash',2,'now','now')").run()
    store.database.prepare("INSERT INTO chapter_summaries(id,book_id,chapter_id,chapter_number,chapter_title,model,status) VALUES('s1','book','ch1',1,'第1章','gemini-2.5-flash','completed')").run()
    assert.throws(()=>store.database.prepare("INSERT INTO chapter_summaries(id,book_id,chapter_id,chapter_number,chapter_title,model,status) VALUES('s2','book','ch1',1,'第1章','gemini-2.5-flash','completed')").run(),/UNIQUE constraint failed/)
    store.close()
    store=new AiAnalysisStore(file)
    assert.equal(store.getSettings().concurrency,7)
    assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM chapter_summaries').get().count,1)
    store.close()
  }finally{await rm(root,{recursive:true,force:true})}
})

test('restores interrupted jobs and in-flight chapters without deleting saved summaries', async () => {
  const root=await mkdtemp(path.join(os.tmpdir(),'bookmind-ai-recovery-'))
  const file=path.join(root,'analysis.sqlite')
  try{
    let store=new AiAnalysisStore(file)
    store.database.prepare("INSERT INTO ai_analysis_jobs(id,book_id,book_name,novel_task_id,status,model,concurrency,created_at,updated_at) VALUES('job','book','Book','task','running','gemini-2.5-flash',2,'now','now')").run()
    store.database.prepare("INSERT INTO ai_analysis_job_chapters(job_id,chapter_id,chapter_number,chapter_title,position,status,updated_at) VALUES('job','ch1',1,'第1章',1,'running','now'),('job','ch2',2,'第2章',2,'completed','now')").run()
    store.database.prepare("INSERT INTO chapter_summaries(id,book_id,chapter_id,chapter_number,chapter_title,model,status) VALUES('summary','book','ch2',2,'第2章','gemini-2.5-flash','completed')").run()
    store.close()
    store=new AiAnalysisStore(file);store.recoverInterruptedJobs()
    assert.equal(store.database.prepare("SELECT status FROM ai_analysis_jobs WHERE id='job'").get().status,'queued')
    assert.equal(store.database.prepare("SELECT status FROM ai_analysis_job_chapters WHERE chapter_id='ch1'").get().status,'pending')
    assert.equal(store.database.prepare("SELECT status FROM ai_analysis_job_chapters WHERE chapter_id='ch2'").get().status,'completed')
    assert.equal(store.database.prepare("SELECT status FROM chapter_summaries WHERE chapter_id='ch2'").get().status,'completed')
    store.close()
  }finally{await rm(root,{recursive:true,force:true})}
})

test('validates Gemini JSON fields and preserves the source chapter number and title', () => {
  const result=parseGeminiChapterAnalysis(JSON.stringify({chapter_number:3,chapter_title:'第3章 转折',summary:'主角在本章做出一个重要决定并离开村庄。',key_events:['主角决定离开村庄。'],characters:['林安'],character_changes:[{character:'林安',change:'决定离开村庄。'}],important_facts:[],clues:[]}),{chapterNumber:3,chapterTitle:'第3章 转折'})
  assert.equal(result.chapter_number,3)
  assert.equal(result.chapter_title,'第3章 转折')
  assert.deepEqual(result.clues,[])
  assert.throws(()=>parseGeminiChapterAnalysis('{broken}',{chapterNumber:3,chapterTitle:'第3章 转折'}),/不是有效 JSON/)
  assert.throws(()=>parseGeminiChapterAnalysis(JSON.stringify({...result,chapter_number:4}),{chapterNumber:3,chapterTitle:'第3章 转折'}),/章节编号与源章节不一致/)
})
