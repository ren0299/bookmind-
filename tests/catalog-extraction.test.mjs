import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupeNovelChapters, extractCatalogLinks, normalizeChapterOrder } from '../electron/services/novel/catalog-extraction.ts'
import { inspectNovelCatalog } from '../electron/services/novel/catalog-integrity.ts'

const baseUrl = new URL('https://novel.example/book/42')

test('prefers the full catalog, merges latest-section duplicates by normalized URL, and keeps completion note', () => {
  const html = `<!doctype html><html><body>
    <section><h2>最新章节</h2><ul>
      <li><a href="/chapter/3?utm_source=home">第3章 新的开始</a></li>
      <li><a href="/chapter/2#top">第2章 旧标题</a></li>
    </ul></section>
    <section><h2>全部章节（共4章）</h2><div class="chapters">
      <a href="/chapter/1">第1章 开始</a>
      <a href="/chapter/2">第2章 选择</a>
      <a href="/chapter/3">第3章 新的开始</a>
      <a href="/chapter/end">完结感言</a>
    </div></section>
  </body></html>`
  const result = extractCatalogLinks(html, 'a[href^="/chapter/"]', baseUrl, 'novel.example')
  assert.equal(result.selectedRegion, 'all-chapters')
  assert.equal(result.duplicateLinkCount, 2)
  assert.deepEqual(result.chapters.map(chapter => chapter.title), ['第1章 开始', '第2章 选择', '第3章 新的开始', '完结感言'])
  assert.deepEqual(result.chapters.map(chapter => chapter.url), [
    'https://novel.example/chapter/1', 'https://novel.example/chapter/2',
    'https://novel.example/chapter/3', 'https://novel.example/chapter/end',
  ])
  const integrity = inspectNovelCatalog(result.chapters, 4, result.duplicateLinkCount)
  assert.equal(integrity.complete, true)
  assert.deepEqual(integrity.missingChapterNumbers, [])
})

test('preserves distinct chapters with the same title and sorts a consistently reversed numbered list', () => {
  const html = `<div class="all-title">全部章节</div><ul>
    <li><a href="/c/end">完结感言</a></li>
    <li><a href="/c/3">第3章 同名</a></li>
    <li><a href="/c/2">第2章 同名</a></li>
    <li><a href="/c/1">第1章 序</a></li>
  </ul>`
  const result = extractCatalogLinks(html, 'a[href^="/c/"]', baseUrl, 'novel.example')
  assert.deepEqual(result.chapters.map(chapter => chapter.title), ['第1章 序', '第2章 同名', '第3章 同名', '完结感言'])
  assert.equal(new Set(result.chapters.map(chapter => chapter.url)).size, 4)
})

test('rebuilds a mixed-order directory from chapter one by ordinal while keeping each title paired with its source URL', () => {
  const html = `<section><h2>最新章节</h2><a href="/chapter/6">第6章 最新</a><a href="/chapter/5">第5章 更新</a></section>
    <section><h2>全部章节</h2><div class="chapters">
      <a href="/chapter/6">第6章 最新</a><a href="/chapter/5">第5章 更新</a>
      <a href="/chapter/1">第1章 开始</a><a href="/chapter/2">第2章 转折</a>
      <a href="/chapter/3">第3章 发现</a><a href="/chapter/4">第4章 继续</a>
      <a href="/special/end">完结感言</a>
    </div></section>`
  const result = extractCatalogLinks(html, 'a[href]', baseUrl, 'novel.example')
  assert.deepEqual(result.chapters.map(chapter => chapter.title), [
    '第1章 开始', '第2章 转折', '第3章 发现', '第4章 继续', '第5章 更新', '第6章 最新', '完结感言',
  ])
  assert.deepEqual(result.chapters.slice(0, 6).map(chapter => chapter.url), Array.from({ length: 6 }, (_, index) => `https://novel.example/chapter/${index + 1}`))
  assert.equal(result.duplicateLinkCount, 2)
  const integrity = inspectNovelCatalog(result.chapters, 7, result.duplicateLinkCount, result.urlTitleMismatchCount)
  assert.equal(integrity.complete, true)
})

test('falls back to selector matches when no full-catalog heading is available', () => {
  const html = `<div><a href="/chapter/1">第1章</a><a href="/chapter/2">第2章</a></div>`
  const result = extractCatalogLinks(html, 'a[href]', baseUrl, 'novel.example')
  assert.equal(result.selectedRegion, 'fallback')
  assert.equal(result.chapters.length, 2)
})

test('task-time deduplication retains the first original title and URL without merging same-titled chapters', () => {
  const result = dedupeNovelChapters([
    { id: 'a', title: '第1章 相同标题', url: 'https://novel.example/c/1?utm_source=latest' },
    { id: 'b', title: '第1章 相同标题', url: 'https://novel.example/c/1' },
    { id: 'c', title: '第2章 相同标题', url: 'https://novel.example/c/2' },
  ])
  assert.equal(result.duplicateLinkCount, 1)
  assert.equal(result.urlTitleMismatchCount, 0)
  assert.deepEqual(result.chapters.map(chapter => chapter.url), [
    'https://novel.example/c/1?utm_source=latest', 'https://novel.example/c/2',
  ])
})

test('flags explicit chapter-number and URL mismatch, and flags the same URL advertised under conflicting chapter numbers', () => {
  const explicitMismatch = extractCatalogLinks(`<h2>全部章节</h2><a href="/chapter/2">第3章 错配</a>`, 'a[href]', baseUrl, 'novel.example')
  assert.equal(explicitMismatch.urlTitleMismatchCount, 1)
  assert.equal(inspectNovelCatalog(explicitMismatch.chapters, undefined, 0, explicitMismatch.urlTitleMismatchCount).complete, false)

  const duplicateConflict = extractCatalogLinks(`<h2>全部章节</h2><a href="/c/shared">第1章</a><a href="/c/shared?utm_source=latest">第2章</a>`, 'a[href]', baseUrl, 'novel.example')
  assert.equal(duplicateConflict.duplicateLinkCount, 1)
  assert.equal(duplicateConflict.urlTitleMismatchCount, 1)
})

test('rebuilds a 1272-entry reversed full catalog from chapter titles and keeps each title bound to its opaque URL', () => {
  const makeLink = number => `<a href="/entry/book-part-${1273-number}">第${number}章 标题${number}</a>`
  const latest = Array.from({ length: 12 }, (_, index) => 1272 - index).map(makeLink).join('')
  const full = Array.from({ length: 1272 }, (_, index) => 1272 - index).map(makeLink).join('')
  const html = `<section><h2>最新章节</h2>${latest}</section><section><h2>全部章节</h2>${full}</section>`
  const result = extractCatalogLinks(html, 'a[href]', baseUrl, 'novel.example')

  assert.equal(result.chapters.length, 1272)
  assert.equal(result.duplicateLinkCount, 12)
  assert.equal(result.chapters[0].title, '第1章 标题1')
  assert.equal(result.chapters[0].url, 'https://novel.example/entry/book-part-1272')
  assert.equal(result.chapters.at(-1).title, '第1272章 标题1272')
  assert.equal(result.chapters.at(-1).url, 'https://novel.example/entry/book-part-1')
  assert.deepEqual([result.chapters[0].chapterNumber, result.chapters[0].position], [1, 1])
  assert.deepEqual([result.chapters.at(-1).chapterNumber, result.chapters.at(-1).position], [1272, 1272])
  assert.ok(result.chapters.every((chapter, index) => chapter.title === `第${index + 1}章 标题${index + 1}` && chapter.id === String(index + 1)))
})

test('sorts the exported chapter object list by recognized title number rather than URL digits and preserves stable IDs', () => {
  const input = [
    { id: 'file-3', title: '第3章', url: 'https://novel.example/post/1' },
    { id: 'file-1', title: '序章', url: 'https://novel.example/post/3' },
    { id: 'file-2', title: '第1章', url: 'https://novel.example/post/2' },
  ]
  const sorted = normalizeChapterOrder(input, false)
  assert.deepEqual(sorted.map(chapter => [chapter.id, chapter.title, chapter.url]), [
    ['file-1', '序章', 'https://novel.example/post/3'],
    ['file-2', '第1章', 'https://novel.example/post/2'],
    ['file-3', '第3章', 'https://novel.example/post/1'],
  ])
})
