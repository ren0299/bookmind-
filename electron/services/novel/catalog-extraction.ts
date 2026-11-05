import * as cheerio from 'cheerio'
import { chapterOrdinal } from './catalog-integrity.ts'

export interface CatalogChapterLink { id: string; title: string; url: string; chapterNumber?:number|null; specialType?:'numbered'|'prologue'|'extra'|'afterword'|'other'; position?:number }
export interface CatalogExtraction { chapters: CatalogChapterLink[]; duplicateLinkCount: number; urlTitleMismatchCount: number; selectedRegion: 'all-chapters' | 'fallback' }

function catalogSectionKind(text: string): 'all' | 'latest' | null {
  const normalized = text.replace(/[\s\u00a0（）()【】：:]/g, '').replaceAll('[', '').replaceAll(']', '').toLocaleLowerCase()
  if (normalized.length <= 32 && /^(?:全部|所有|完整|章节|章節|小说章节|小說章節).*(?:章节|章節|目录|目錄)/.test(normalized)) return 'all'
  if (normalized.length <= 24 && /^最新.*(?:章节|章節|更新)/.test(normalized)) return 'latest'
  return null
}

export function normalizeChapterUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  if (/^#(?:top|comments?|footer|header|navigation|toc)$/i.test(url.hash)) url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|ref|from|source|spm)$/i.test(key)) url.searchParams.delete(key)
  }
  return url.toString()
}

function explicitUrlChapterOrdinal(url: URL): number | null {
  const match=url.pathname.match(/\/(?:chapter|chapters|chap|ch|read)\/(\d+)(?:\.html?)?\/?$/i)
    ??url.pathname.match(/\/(?:chapter|chap|ch|read)[_-](\d+)(?:\.html?)?\/?$/i)
    ??url.pathname.match(/\/第(\d+)(?:章|节|節|话|話)(?:\.html?)?\/?$/i)
  return match?Number(match[1]):null
}

export function dedupeNovelChapters<T extends { title: string; url: string }>(chapters: T[]): { chapters: T[]; duplicateLinkCount: number; urlTitleMismatchCount: number } {
  const seen = new Set<string>(), unique: T[] = []
  const titleByUrl = new Map<string,string>()
  let duplicateLinkCount = 0, urlTitleMismatchCount = 0
  for (const chapter of chapters) {
    const key=normalizeChapterUrl(chapter.url),ordinal=chapterOrdinal(chapter.title),priorTitle=titleByUrl.get(key)
    if (seen.has(key)) {
      duplicateLinkCount += 1
      const priorOrdinal=priorTitle?chapterOrdinal(priorTitle):null
      if(ordinal!==null&&priorOrdinal!==null&&ordinal!==priorOrdinal)urlTitleMismatchCount+=1
      continue
    }
    seen.add(key);titleByUrl.set(key,chapter.title)
    unique.push(chapter)
  }
  return { chapters: unique, duplicateLinkCount, urlTitleMismatchCount }
}

export function normalizeChapterOrder(chapters: CatalogChapterLink[], reassignIds = true): CatalogChapterLink[] {
  const preface: CatalogChapterLink[] = [], numbered: CatalogChapterLink[] = [], middle: CatalogChapterLink[] = [], afterword: CatalogChapterLink[] = []
  for (const chapter of chapters) {
    if (chapterOrdinal(chapter.title) !== null) numbered.push(chapter)
    else if (/序章|序言|楔子|前言|引子|prologue/i.test(chapter.title)) preface.push(chapter)
    else if (/完结感言|完結感言|后记|後記|尾声|尾聲|番外|epilogue|后话|後話/i.test(chapter.title)) afterword.push(chapter)
    else middle.push(chapter)
  }
  numbered.sort((left,right)=>(chapterOrdinal(left.title)??0)-(chapterOrdinal(right.title)??0))
  return [...preface, ...numbered, ...middle, ...afterword].map((chapter,index)=>{
    const chapterNumber=chapterOrdinal(chapter.title)
    const specialType=chapterNumber!==null?'numbered':preface.includes(chapter)?'prologue':afterword.includes(chapter)?(/番外/i.test(chapter.title)?'extra':'afterword'):'other'
    return {...chapter,id:reassignIds?String(index+1):chapter.id,chapterNumber,specialType,position:index+1}
  })
}

/** Extract selector-matched links, preferring an explicitly labelled full catalog over latest-update sections. */
export function extractCatalogLinks(html: string, selector: string, pageUrl: URL, host: string, normalizeReverseOrder = true): CatalogExtraction {
  const $ = cheerio.load(html)
  let selectorMatches: ReturnType<typeof $>
  try { selectorMatches = $(selector) }
  catch (error) { throw new Error(`章节目录选择器无效：${error instanceof Error ? error.message : String(error)}`, { cause: error }) }

  const selectedAnchors = new Set<object>()
  selectorMatches.each((_index, element) => {
    if (element.type === 'tag' && element.name === 'a') selectedAnchors.add(element)
    else $(element).find('a[href]').each((_anchorIndex, anchor) => { selectedAnchors.add(anchor) })
  })

  const orderedElements = $.root().find('*').toArray()
  const elementOrder = new Map<object, number>(orderedElements.map((element, index) => [element, index]))
  const labels: Array<{ order: number; kind: 'all' | 'latest' }> = []
  const headingSelector = 'h1,h2,h3,h4,h5,h6,dt,strong,b,[class*="title"],[id*="title"]'
  $(headingSelector).each((_index, element) => {
    const kind = catalogSectionKind($(element).text())
    const order = elementOrder.get(element)
    if (kind && order !== undefined) labels.push({ order, kind })
  })
  labels.sort((left, right) => left.order - right.order)

  const entries: Array<{ chapter: CatalogChapterLink; region: 'all' | 'latest' | null; urlTitleMismatch:boolean }> = []
  for (const element of orderedElements) {
    if (!selectedAnchors.has(element)) continue
    const href = $(element).attr('href')
    const title = $(element).text().trim()
    if (!href || !title) continue
    let target: URL
    try { target = new URL(href, pageUrl) } catch { continue }
    if (target.protocol !== 'https:' || target.hostname.toLowerCase() !== host.toLowerCase()) continue
    const titleOrdinal=chapterOrdinal(title),urlOrdinal=explicitUrlChapterOrdinal(target)
    const urlTitleMismatch=titleOrdinal!==null&&urlOrdinal!==null&&titleOrdinal!==urlOrdinal
    const order = elementOrder.get(element) ?? 0
    let region: 'all' | 'latest' | null = null
    for (const label of labels) {
      if (label.order > order) break
      region = label.kind
    }
    entries.push({ chapter: { id: '', title: title.slice(0, 300), url: target.toString() }, region, urlTitleMismatch })
  }

  const hasFullRegion = entries.some(entry => entry.region === 'all')
  const preferred = hasFullRegion
    ? [...entries.filter(entry => entry.region === 'all'), ...entries.filter(entry => entry.region === 'latest')]
    : entries
  const chapters: CatalogChapterLink[] = []
  const seen = new Set<string>()
  let duplicateLinkCount = 0, urlTitleMismatchCount=0
  const titleByUrl = new Map<string,string>()
  for (const { chapter, urlTitleMismatch } of preferred) {
    if(urlTitleMismatch)urlTitleMismatchCount+=1
    const key = normalizeChapterUrl(chapter.url)
    if (seen.has(key)) {
      duplicateLinkCount += 1
      const priorOrdinal=chapterOrdinal(titleByUrl.get(key)??''),currentOrdinal=chapterOrdinal(chapter.title)
      if(priorOrdinal!==null&&currentOrdinal!==null&&priorOrdinal!==currentOrdinal)urlTitleMismatchCount+=1
      continue
    }
    seen.add(key)
    titleByUrl.set(key,chapter.title)
    chapters.push({ ...chapter, id: String(chapters.length + 1) })
  }

  // Pair each anchor's own title and URL first, then build chapter order from title ordinals.
  return { chapters: normalizeReverseOrder ? normalizeChapterOrder(chapters) : chapters, duplicateLinkCount, urlTitleMismatchCount, selectedRegion: hasFullRegion ? 'all-chapters' : 'fallback' }
}
