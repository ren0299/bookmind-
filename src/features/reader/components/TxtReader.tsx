import { useEffect, useState } from 'react'
import type { Book } from '../../../../shared/types/book.ts'
import type { ReadingProgress } from '../../../../shared/types/library-state.ts'
import { listNovelBookChapters, readNovelChapter } from '../../../services/library.ts'

interface TxtReaderProps { book: Book; savedProgress?: ReadingProgress | null; onProgressChange?: (bookId: string, progress: ReadingProgress) => void; onAnalyze?: (bookId:string)=>void }

export function TxtReader({ book, savedProgress, onProgressChange, onAnalyze }: TxtReaderProps) {
  const [titles, setTitles] = useState<Array<{ title: string }>>([])
  const [chapterIndex, setChapterIndex] = useState(0)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!book.novelTaskId) { window.setTimeout(() => { if (active) { setError('找不到这本 TXT 小说对应的章节索引。'); setLoading(false) } }, 0); return () => { active = false } }
    void listNovelBookChapters(book.novelTaskId).then((items) => {
      if (!active) return
      setError(null)
      setTitles(items)
      setChapterIndex(Math.max(0, Math.min(items.length - 1, (savedProgress?.pageNum ?? 1) - 1)))
    }).catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '读取章节目录失败。') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [book.id, book.novelTaskId, savedProgress?.pageNum])

  useEffect(() => {
    let active = true
    if (!book.novelTaskId || titles.length === 0) return
    const timer = window.setTimeout(() => {
      if (!active) return
      setLoading(true); setError(null)
      void readNovelChapter(book.novelTaskId!, chapterIndex).then((chapter) => { if (active) setContent(chapter.content) })
        .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : '读取章节失败。') })
        .finally(() => { if (active) setLoading(false) })
    }, 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [book.novelTaskId, chapterIndex, titles.length])

  useEffect(() => {
    if (titles.length > 0) onProgressChange?.(book.id, { pageNum: chapterIndex + 1, zoomLevel: savedProgress?.zoomLevel ?? 1 })
  }, [book.id, chapterIndex, titles.length, onProgressChange, savedProgress?.zoomLevel])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (loading || titles.length === 0) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setChapterIndex((index) => Math.max(0, index - 1))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setChapterIndex((index) => Math.min(titles.length - 1, index + 1))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [loading, titles.length])

  return <div className="txt-reader">
    <header className="txt-reader-header"><div><p>{book.author ?? 'TXT 小说'}</p><h1>{book.name}</h1></div><div className="txt-reader-actions"><label>章节 <select value={chapterIndex} onChange={(event) => setChapterIndex(Number(event.target.value))}>{titles.map((item, index) => <option key={index} value={index}>{item.title}</option>)}</select><span>{titles.length ? `${chapterIndex + 1} / ${titles.length}` : ''}</span></label><button className="subtle-action" onClick={()=>onAnalyze?.(book.id)}>AI 分析</button></div></header>
    <article className="txt-reader-content"><h2>{titles[chapterIndex]?.title}</h2>{loading ? <p className="novel-muted">章节加载中…</p> : error ? <p className="reader-status reader-status--error">{error}</p> : <div className="txt-prose">{content.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>}</article>
    <footer className="reader-controls"><button className="reader-nav-btn" onClick={() => setChapterIndex((index) => Math.max(0, index - 1))} disabled={chapterIndex <= 0}>上一章</button><span className="reader-page-info">{titles.length ? `第 ${chapterIndex + 1} / ${titles.length} 章` : '读取目录…'}</span><button className="reader-nav-btn" onClick={() => setChapterIndex((index) => Math.min(titles.length - 1, index + 1))} disabled={chapterIndex >= titles.length - 1}>下一章</button></footer>
  </div>
}
