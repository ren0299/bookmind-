import test from 'node:test'
import assert from 'node:assert/strict'
import { assertCatalogHasChapters, inspectNovelCatalog } from '../electron/services/novel/catalog-integrity.ts'

test('reports chapter-number gaps as warnings without blocking task creation', () => {
  const titles = [
    ...Array.from({ length: 15 }, (_, index) => `第${index + 1}章`),
    ...Array.from({ length: 21 }, (_, index) => `第${index + 215}章`),
  ]
  const report = inspectNovelCatalog(titles.map((title) => ({ title })), 235, 0)

  assert.equal(report.chapterCount, 36)
  assert.equal(report.complete, false)
  assert.deepEqual(report.missingChapterNumbers, [{ from: 16, to: 214 }])
  assert.match(report.warnings.join(' '), /16-214/)
  assert.doesNotThrow(() => assertCatalogHasChapters(report))
})

test('accepts a complete directory numbered from chapter one through its final chapter', () => {
  const chapters = Array.from({ length: 42 }, (_, index) => ({ title: `第${index + 1}章`, url: `https://novel.example/chapter/${index + 1}` }))
  const report = inspectNovelCatalog(chapters, 42, 0)

  assert.equal(report.complete, true)
  assert.equal(report.chapterCount, 42)
  assert.deepEqual(report.missingChapterNumbers, [])
  assert.equal(chapters[15].title, '第16章')
})

test('flags missing chapter numbers and duplicate chapter numbers mapped to different URLs', () => {
  const report = inspectNovelCatalog([{ title: '第1章', url: 'https://example/1' }, { title: '第3章', url: 'https://example/3' }, { title: '第3章 番外误链', url: 'https://example/other' }], undefined, 0)

  assert.equal(report.complete, false)
  assert.equal(report.duplicateLinkCount, 0)
  assert.equal(report.duplicateChapterNumberCount, 1)
  assert.deepEqual(report.missingChapterNumbers, [{ from: 2, to: 2 }])
})

test('detects missing trailing chapters and unnumbered entries', () => {
  const truncated = inspectNovelCatalog([{ title: '第1章' }, { title: '第2章' }], 3, 0)
  assert.equal(truncated.complete, false)
  assert.deepEqual(truncated.missingChapterNumbers, [{ from: 3, to: 3 }])

  const unnumbered = inspectNovelCatalog([{ title: '序章' }, { title: '第1章 正文' }, { title: '番外' }, { title: '完结感言' }], 4, 0)
  assert.equal(unnumbered.complete, true)
  assert.match(unnumbered.warnings.join(' '), /没有标准数字编号，已保留/)
})

test('duplicate links and non-numbered completion notes are informational after deduplication', () => {
  const report = inspectNovelCatalog([{ title: '第1章' }, { title: '第2章' }, { title: '完结感言' }], 3, 4)
  assert.equal(report.complete, true)
  assert.equal(report.duplicateLinkCount, 4)
  assert.deepEqual(report.missingChapterNumbers, [])
  assert.match(report.warnings.join(' '), /合并 4 个重复链接/)
  assert.doesNotThrow(() => assertCatalogHasChapters(report))
})

test('only an empty catalog is rejected at task creation time', () => {
  assert.throws(() => assertCatalogHasChapters(inspectNovelCatalog([], undefined, 0)), /没有可下载的章节链接/)
})
