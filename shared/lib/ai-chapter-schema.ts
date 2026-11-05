import type { GeminiChapterAnalysis } from '../types/ai-analysis.ts'

function stringArray(value:unknown,field:string):string[]{
  if(!Array.isArray(value)||value.length>100||value.some(item=>typeof item!=='string'||item.length>1000))throw new Error(`字段 ${field} 必须是字符串数组。`)
  return value.map(item=>(item as string).trim()).filter(Boolean)
}

export function parseGeminiChapterAnalysis(raw:string,expected:{chapterNumber:number|null;chapterTitle:string}):GeminiChapterAnalysis{
  const cleaned=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')
  let value:unknown
  try{value=JSON.parse(cleaned)}catch(error){throw new Error(`Gemini 返回的摘要不是有效 JSON：${error instanceof Error?error.message:String(error)}`,{cause:error})}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Gemini 摘要必须是 JSON 对象。')
  const data=value as Record<string,unknown>
  if((data.chapter_number??null)!==expected.chapterNumber)throw new Error('AI 返回的章节编号与源章节不一致。')
  if(typeof data.chapter_title!=='string'||data.chapter_title.trim()!==expected.chapterTitle)throw new Error('AI 返回的章节标题与源章节不一致。')
  if(typeof data.summary!=='string'||data.summary.trim().length<10||data.summary.length>8000)throw new Error('AI 返回的 summary 为空或超出长度限制。')
  if(!Array.isArray(data.character_changes)||data.character_changes.length>100)throw new Error('字段 character_changes 必须是对象数组。')
  const characterChanges=data.character_changes.map((item,index)=>{
    if(!item||typeof item!=='object'||typeof (item as Record<string,unknown>).character!=='string'||typeof (item as Record<string,unknown>).change!=='string')throw new Error(`字段 character_changes[${index}] 格式无效。`)
    const change=item as {character:string;change:string}
    return {character:change.character.trim().slice(0,200),change:change.change.trim().slice(0,1000)}
  }).filter(item=>item.character&&item.change)
  return {
    chapter_number:expected.chapterNumber,
    chapter_title:expected.chapterTitle,
    summary:data.summary.trim(),
    key_events:stringArray(data.key_events,'key_events'),
    characters:stringArray(data.characters,'characters'),
    character_changes:characterChanges,
    important_facts:stringArray(data.important_facts,'important_facts'),
    clues:stringArray(data.clues,'clues'),
  }
}
