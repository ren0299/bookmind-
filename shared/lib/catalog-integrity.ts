import type { NovelCatalogIntegrity } from '../types/novel.ts'

export function chapterOrdinal(title:string):number|null{
  const normalized=title.replace(/[０-９]/g,digit=>String(digit.charCodeAt(0)-0xFF10))
  const chinese=normalized.match(/第\s*(\d+)\s*(?:章|節|节|回|集|卷|篇|话|話)/)
  const english=normalized.match(/\b(?:chapter|chap\.?|ch\.?)\s*(\d+|[ivxlcdm]+)\b/i)
  const match=chinese??english
  let ordinal=match?Number(match[1]):null
  if(!chinese&&english&&Number.isNaN(ordinal)){
    const roman=english[1].toUpperCase(),values:Record<string,number>={I:1,V:5,X:10,L:50,C:100,D:500,M:1000}
    let total=0,previous=0
    for(const letter of [...roman].reverse()){const value=values[letter]??0;total+=value<previous?-value:value;previous=Math.max(previous,value)}
    ordinal=total
  }
  return ordinal!==null&&Number.isSafeInteger(ordinal)&&ordinal>=1?ordinal:null
}

export function inspectNovelCatalog(chapters:Array<{title:string;url?:string}>,expectedChapterCount:number|undefined,duplicateLinkCount:number,urlTitleMismatchCount=0):NovelCatalogIntegrity{
  const numbered=chapters.map((chapter)=>({chapter,number:chapterOrdinal(chapter.title)})).filter((entry):entry is {chapter:typeof chapters[number];number:number}=>entry.number!==null)
  const byNumber=new Map<number,string|undefined>()
  let duplicateChapterNumberCount=0
  for(const {chapter,number} of numbered){
    if(byNumber.has(number)){
      if(!chapter.url||!byNumber.get(number)||chapter.url!==byNumber.get(number))duplicateChapterNumberCount+=1
    }else byNumber.set(number,chapter.url)
  }
  const numbers=[...byNumber.keys()].sort((left,right)=>left-right)
  const missingChapterNumbers:Array<{from:number;to:number}>=[]
  let outOfOrder=false
  if(numbers.length>0){
    let previous=0
    for(const current of numbers){
      if(current>previous+1)missingChapterNumbers.push({from:previous+1,to:current-1})
      previous=current
    }
    const sourceOrder=numbered.map(entry=>entry.number)
    outOfOrder=sourceOrder.some((number,index)=>index>0&&number<sourceOrder[index-1])
    const lastNumber=numbers[numbers.length-1]
    if(expectedChapterCount!==undefined&&numbered.length===chapters.length&&lastNumber<expectedChapterCount)missingChapterNumbers.push({from:lastNumber+1,to:expectedChapterCount})
  }else if(chapters.length)missingChapterNumbers.push({from:1,to:1})
  const warnings:string[]=[]
  const countMatches=expectedChapterCount===undefined||chapters.length===expectedChapterCount
  if(expectedChapterCount!==undefined&&!countMatches)warnings.push(`网页标注共 ${expectedChapterCount} 章，实际提取 ${chapters.length} 条。`)
  if(numbered.length!==chapters.length)warnings.push(`${chapters.length-numbered.length} 条目录标题（如序章、番外或完结感言）没有标准数字编号，已保留。`)
  if(missingChapterNumbers.length)warnings.push(`章节编号存在缺口：${missingChapterNumbers.map(({from,to})=>from===to?String(from):`${from}-${to}`).join('、')}。`)
  if(outOfOrder)warnings.push('章节编号尚未按正序排列；请重新解析以按真实编号重建目录。')
  if(duplicateChapterNumberCount)warnings.push(`有 ${duplicateChapterNumberCount} 个章节编号对应多个不同 URL，无法确定正确链接。`)
  if(urlTitleMismatchCount)warnings.push(`有 ${urlTitleMismatchCount} 个重复 URL 的章节标题编号互相冲突。`)
  if(duplicateLinkCount)warnings.push(`已按章节 URL 合并 ${duplicateLinkCount} 个重复链接。`)
  if(expectedChapterCount!==undefined&&!countMatches)warnings.push('提取数量与网页声明数量不一致，可能是目录分页或动态加载内容尚未提取完整。')
  return {expectedChapterCount,chapterCount:chapters.length,duplicateLinkCount,duplicateChapterNumberCount,urlTitleMismatchCount,missingChapterNumbers,outOfOrder,complete:chapters.length>0&&countMatches&&missingChapterNumbers.length===0&&!outOfOrder&&duplicateChapterNumberCount===0&&urlTitleMismatchCount===0,warnings}
}

export function assertCatalogHasChapters(integrity:NovelCatalogIntegrity):void{
  if(integrity.chapterCount===0)throw new Error('目录没有可下载的章节链接。')
}
