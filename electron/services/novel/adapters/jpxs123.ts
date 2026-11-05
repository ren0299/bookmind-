import type { NovelMetadata } from '../../../../shared/types/novel.ts'
import type { NovelAdapter } from './types.ts'
import { NovelDownloadError, assertNoAccessChallenge, retryAfterMilliseconds } from '../download-scheduler.ts'

const HOSTS = new Set(['jpxs123.com', 'www.jpxs123.com'])

function siteUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password || url.port) {
    throw new Error('仅支持 jpxs123.com 官方 HTTPS 小说页面。')
  }
  if (!/^\/(?:[a-z0-9_-]+\/)?\d+(?:\/\d+)?\.html$/i.test(url.pathname)) {
    throw new Error('请使用 jpxs123.com 的小说目录页或章节页 URL。')
  }
  return url
}

function decodeHtml(value: string): string {
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

function textOf(html: string): string {
  return decodeHtml(html.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p\s*>/gi, '\n').replace(/<[^>]*>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

function bookId(url: URL): { category: string; id: string } {
  const match = url.pathname.match(/^\/([a-z0-9_-]+)\/(\d+)(?:\/\d+)?\.html$/i)
  if (!match) throw new Error('无法从该地址识别小说目录。')
  return { category: match[1], id: match[2] }
}

function catalogUrl(url: URL): string {
  const { category, id } = bookId(url)
  return `${url.origin}/${category}/${id}.html`
}

async function fetchPage(input: string): Promise<string> {
  let url = siteUrl(input)
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    let response:Response
    try{response = await fetch(url, {
      headers: { 'User-Agent': 'BookMind/1.0 (desktop reader; user-requested public page)' },
      signal: AbortSignal.timeout(20_000),
      redirect: 'manual',
    })}catch(error){throw new NovelDownloadError('network',`jpxs123.com 网络请求失败：${error instanceof Error?error.message:String(error)}`,undefined,undefined,{cause:error})}
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location || redirects === 3) throw new Error('小说站点重定向次数过多或目标无效。')
      url = siteUrl(new URL(location, url).toString())
      continue
    }
    if(!response.ok){if(response.status===429)throw new NovelDownloadError('rate-limit','jpxs123.com 返回 HTTP 429。',429,retryAfterMilliseconds(response.headers.get('retry-after')));if(response.status===403)throw new NovelDownloadError('access','jpxs123.com 返回 HTTP 403，访问已暂停。',403);if(response.status>=500)throw new NovelDownloadError('server',`jpxs123.com 返回 HTTP ${response.status}。`,response.status);throw new NovelDownloadError('permanent',`jpxs123.com 返回 HTTP ${response.status}。`,response.status)}
    const type = response.headers.get('content-type') ?? ''
    if (type && !/text\/html|application\/xhtml\+xml/i.test(type)) throw new Error('该地址没有返回 HTML 小说页面。')
    const bytes = new Uint8Array(await response.arrayBuffer())
    const bytePrefix = new TextDecoder('iso-8859-1').decode(bytes.subarray(0, Math.min(bytes.length, 4096)))
    const charset = type.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]
      ?? bytePrefix.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]
      ?? 'utf-8'
    try { const html=new TextDecoder(charset).decode(bytes);assertNoAccessChallenge(html,url.hostname);return html }
    catch { throw new Error(`无法读取页面字符编码（${charset}）。`) }
  }
  throw new Error('无法读取小说页面。')
}

function chapterBody(html: string): { title: string; content: string } {
  const area = html.match(/<div\b[^>]*class=["'][^"']*read_chapterDetail[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
  if (!area) throw new Error('页面中没有找到章节正文区域（read_chapterDetail）。')
  const clean = area.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  const paragraphs = [...clean.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => textOf(match[1]))
    .filter((paragraph) => paragraph.length > 0)
  const headingPattern = /^第\s*\d+\s*(?:章|节|回|集|卷|篇|幕)/i
  const firstHeading = paragraphs.findIndex((paragraph) => headingPattern.test(paragraph))
  if (firstHeading < 0) {
    const pageHeading = textOf(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
    const title = pageHeading.replace(/_[^_]+$/, '').trim()
    const content = paragraphs.join('\n\n').trim()
    if (!title || content.length < 20) throw new Error('正文格式无法识别：没有找到章节标题或正文。')
    return { title, content }
  }
  const nextHeading = paragraphs.findIndex((paragraph, index) => index > firstHeading && headingPattern.test(paragraph))
  const chapterParagraphs = paragraphs.slice(firstHeading, nextHeading < 0 ? undefined : nextHeading)
  const title = chapterParagraphs[0]
  const content = chapterParagraphs.slice(1).join('\n\n').trim()
  if (content.length < 20) throw new Error('章节正文为空或内容格式无法识别。')
  return { title, content }
}

export const jpxs123Adapter: NovelAdapter = {
  id: 'jpxs123',
  matches: (url) => HOSTS.has(url.hostname.toLowerCase()),
  async parse(input): Promise<NovelMetadata> {
    const inputUrl = siteUrl(input.toString())
    const catalogPageUrl = catalogUrl(inputUrl)
    const html = await fetchPage(catalogPageUrl)
    const heading = textOf(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
    const name = heading.replace(/\s*\(\s*\d+\s*-\s*\d+\s*\)\s*$/, '').trim()
    const authorMarkup = html.match(/作者\s*[：:]\s*([\s\S]*?)<\/span>/i)?.[1] ?? ''
    const author = textOf(authorMarkup)
    if (!name || !author) throw new Error('无法从 jpxs123.com 目录页识别小说名称或作者。')
    const { category, id } = bookId(inputUrl)
    const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']*\/\d+\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    const unique = new Map<string, { id: string; title: string; url: string }>()
    for (const link of links) {
      const target = new URL(link[1], catalogPageUrl)
      if (!HOSTS.has(target.hostname.toLowerCase()) || target.protocol !== 'https:') continue
      const targetParts = target.pathname.match(/^\/([a-z0-9_-]+)\/(\d+)\/(\d+)\.html$/i)
      if (!targetParts || targetParts[1] !== category || targetParts[2] !== id) continue
      const number = targetParts[3]
      const title = textOf(link[2])
      if (!/^(?:第\s*\d+|序章|楔子|前言)/i.test(title)) continue
      if (!unique.has(number)) unique.set(number, { id: number, title: title || `第${number}节`, url: target.toString() })
    }
    const chapters = [...unique.values()].sort((left, right) => Number(left.id) - Number(right.id))
    if (chapters.length === 0) throw new Error('目录页没有找到章节链接。')
    return { sourceUrl: catalogPageUrl, name, author, chapters }
  },
  async fetchChapter(input: string): Promise<string> {
    const url = siteUrl(input)
    if (!/^\/[a-z0-9_-]+\/\d+\/\d+\.html$/i.test(url.pathname)) throw new Error('该链接不是有效的 jpxs123.com 章节页。')
    const { content } = chapterBody(await fetchPage(url.toString()))
    return content
  },
}
