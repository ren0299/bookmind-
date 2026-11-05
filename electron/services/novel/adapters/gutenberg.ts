import type { NovelAdapter } from './types.ts'
import { NovelDownloadError, assertNoAccessChallenge, retryAfterMilliseconds } from '../download-scheduler.ts'

const HOSTS = new Set(['gutenberg.org', 'www.gutenberg.org'])
const htmlCache = new Map<string, string>()
const CHAPTER_HEADING = /^(?:(?:chapter|book|part|volume|letter|section|appendix|prologue|epilogue)\b|(?:序章|终章|第\s*[\divxlcdm一二三四五六七八九十百千]+\s*[章节卷部回幕集]))/i

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote)\s*>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function safeUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password) {
    throw new Error('出于安全限制，仅支持 Project Gutenberg 官方 HTTPS 页面。')
  }
  return url
}

async function fetchHtml(input: string): Promise<string> {
  let url = safeUrl(input)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response:Response
    try{response = await fetch(url, {
      headers: { 'User-Agent': 'BookMind/1.0 (desktop reader; public-domain text access)' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'manual',
    })}catch(error){throw new NovelDownloadError('network',`Project Gutenberg 网络请求失败：${error instanceof Error?error.message:String(error)}`,undefined,undefined,{cause:error})}
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location || redirects === 3) throw new Error('网站重定向次数过多或目标无效。')
      url = safeUrl(new URL(location, url).toString())
      continue
    }
    if(!response.ok){if(response.status===429)throw new NovelDownloadError('rate-limit',`Project Gutenberg 返回 HTTP 429。`,429,retryAfterMilliseconds(response.headers.get('retry-after')));if(response.status===403)throw new NovelDownloadError('access','Project Gutenberg 返回 HTTP 403，访问已暂停。',403);if(response.status>=500)throw new NovelDownloadError('server',`Project Gutenberg 返回 HTTP ${response.status}。`,response.status);throw new NovelDownloadError('permanent',`Project Gutenberg 返回 HTTP ${response.status}。`,response.status)}
    const type = response.headers.get('content-type') ?? ''
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('目标不是可读取的 HTML 页面。')
    const html=await response.text();assertNoAccessChallenge(html,url.hostname);return html
  }
  throw new Error('无法读取该页面。')
}

function getEbookId(url: URL): string {
  const match = url.pathname.match(/\/(?:ebooks|cache\/epub|files)\/(\d+)/)
  if (!match) throw new Error('请提供 Project Gutenberg 书目页或电子书 HTML 页 URL。')
  return match[1]
}

function getMeta(html: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const row = html.match(new RegExp(`<tr[^>]*>[\\s\\S]*?<th[^>]*>\\s*${escaped}\\s*<\\/th>[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>[\\s\\S]*?<\\/tr>`, 'i'))
  return row ? stripTags(row[1]) : ''
}

function sectionBody(html: string): string {
  const clean = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/(?:nav|header|footer|aside)>/gi, '')
    .replace(/<div\b[^>]*(?:class|id)=["'][^"']*(?:pg-header|pg-footer|navigation|contents|toc)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, '')
  const paragraphs = [...clean.matchAll(/<(?:p|div)\b[^>]*>([\s\S]*?)<\/(?:p|div)>/gi)]
    .map((match) => stripTags(match[1]))
    .filter((paragraph) => paragraph.length > 0 && !/^\[(?:Illustration|Illustration:|Pg\s)/i.test(paragraph))
  if (paragraphs.length) return paragraphs.join('\n\n')
  return stripTags(clean)
}

export const gutenbergAdapter: NovelAdapter = {
  id: 'gutenberg',
  matches: (url) => HOSTS.has(url.hostname.toLowerCase()),
  async parse(input) {
    const url = safeUrl(input.toString())
    const ebookId = getEbookId(url)
    const catalog = await fetchHtml(`https://www.gutenberg.org/ebooks/${ebookId}`)
    const title = getMeta(catalog, 'Title') || stripTags(catalog.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
    const author = getMeta(catalog, 'Author') || '未知作者'
    if (!title) throw new Error('无法从 Project Gutenberg 书目页识别书名。')
    let html = ''
    let textUrl = ''
    for (const candidate of [
      `https://www.gutenberg.org/cache/epub/${ebookId}/pg${ebookId}-images.html`,
      `https://www.gutenberg.org/cache/epub/${ebookId}/pg${ebookId}.html`,
    ]) {
      try {
        html = await fetchHtml(candidate)
        textUrl = candidate
        break
      } catch { /* try the standard alternate Gutenberg HTML filename */ }
    }
    if (!html) throw new Error('已识别书目，但找不到可用的 HTML 正文版本。')
    htmlCache.set(textUrl, html)
    const startIndex = html.search(/\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i)
    const endIndex = html.search(/\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i)
    if (startIndex >= 0) html = html.slice(startIndex)
    if (endIndex >= 0) html = html.slice(0, Math.max(0, endIndex - (startIndex >= 0 ? startIndex : 0)))
    const headingMatches = [...html.matchAll(/<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    const chapterHeads = headingMatches.filter((match) => CHAPTER_HEADING.test(stripTags(match[2])))
    const sections: Array<{ title: string; html: string }> = []
    if (chapterHeads.length) {
      for (let i = 0; i < chapterHeads.length; i += 1) {
        const heading = chapterHeads[i]
        const next = chapterHeads[i + 1]
        const start = (heading.index ?? 0) + heading[0].length
        sections.push({ title: stripTags(heading[2]), html: html.slice(start, next?.index ?? html.length) })
      }
    } else {
      const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
      sections.push({ title: title, html: bodyMatch?.[1] ?? html })
    }
    const chapters = sections.map((section, index) => ({
      id: String(index + 1),
      title: section.title || `章节 ${index + 1}`,
      url: `${textUrl}#chapter-${index + 1}`,
    }))
    if (chapters.length === 0) throw new Error('没有从页面中找到可解析的章节。')
    return { sourceUrl: input.toString(), name: title, author, chapters }
  },
  async fetchChapter(input) {
    const url = safeUrl(input)
    const match = url.hash.match(/^#chapter-(\d+)$/)
    if (!match) throw new Error('章节链接格式无效。')
    const chapterNumber = Number(match[1])
    const pageUrl = `${url.origin}${url.pathname}`
    const html = htmlCache.get(pageUrl) ?? await fetchHtml(pageUrl)
    htmlCache.set(pageUrl, html)
    const startIndex = html.search(/\*{3}\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i)
    const endIndex = html.search(/\*{3}\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i)
    const bookHtml = startIndex >= 0 ? html.slice(startIndex, endIndex > startIndex ? endIndex : undefined) : html
    const heads = [...bookHtml.matchAll(/<(h[2-4])\b[^>]*>([\s\S]*?)<\/\1>/gi)]
      .filter((heading) => CHAPTER_HEADING.test(stripTags(heading[2])))
    let content: string
    if (heads.length) {
      const heading = heads[chapterNumber - 1]
      if (!heading) throw new Error('章节在来源页面中不存在，请重新解析目录。')
      const next = heads[chapterNumber]
      const start = (heading.index ?? 0) + heading[0].length
      content = sectionBody(bookHtml.slice(start, next?.index ?? bookHtml.length))
    } else if (chapterNumber === 1) {
      content = sectionBody(bookHtml)
    } else {
      throw new Error('该电子书正文没有可识别的章节标题。')
    }
    if (content.length < 20) throw new Error('该章节正文为空或格式无法识别。')
    return content
  },
}
