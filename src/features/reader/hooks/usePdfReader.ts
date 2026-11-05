import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import type { Book } from '../../../../shared/types/book.ts'
import type { ReadingProgress } from '../../../../shared/types/library-state.ts'
import {
  clampZoom,
  DEFAULT_ZOOM,
  loadPdfDocument,
  releasePdfDocument,
  withPdfLock,
} from '../../../lib/pdf.ts'
import { readPdfFile } from '../../../services/pdf.ts'

const ZOOM_STEP = 1.1

export function usePdfReader(
  book: Book | null,
  savedProgress?: ReadingProgress | null,
  onProgressChange?: (bookId: string, progress: ReadingProgress) => void,
) {
  const [pageNum, setPageNum] = useState(1)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)

  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const loadTaskRef = useRef<PDFDocumentLoadingTask | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const savedProgressRef = useRef(savedProgress)

  savedProgressRef.current = savedProgress

  const handleRenderError = useCallback((message: string) => {
    setError(message)
  }, [])

  useEffect(() => {
    if (!book) {
      pdfDocRef.current = null
      loadTaskRef.current = null
      setPdfDoc(null)
      setNumPages(0)
      setPageNum(1)
      setError(null)
      setZoomLevel(DEFAULT_ZOOM)
      return
    }

    const { path } = book
    const progress = savedProgressRef.current
    const savedPage = progress?.pageNum ?? 1
    const savedZoom = progress?.zoomLevel ?? DEFAULT_ZOOM
    let active = true

    setLoading(true)
    setError(null)
    setPdfDoc(null)
    pdfDocRef.current = null
    setNumPages(0)
    setPageNum(1)
    setZoomLevel(savedZoom)

    void withPdfLock(async () => {
      const previousDoc = pdfDocRef.current
      const previousTask = loadTaskRef.current
      pdfDocRef.current = null
      loadTaskRef.current = null

      if (previousDoc || previousTask) {
        await releasePdfDocument(previousDoc, previousTask)
      }

      if (!active) return

      try {
        const data = await readPdfFile(path)
        if (!active) return

        const { doc, task } = await loadPdfDocument(data)
        if (!active) {
          await releasePdfDocument(doc, task)
          return
        }

        pdfDocRef.current = doc
        loadTaskRef.current = task

        const nextPage = Math.min(Math.max(1, savedPage), doc.numPages)
        setPdfDoc(doc)
        setNumPages(doc.numPages)
        setPageNum(nextPage)
        setZoomLevel(savedZoom)
        setError(null)
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : '加载失败')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    })

    return () => {
      active = false

      const doc = pdfDocRef.current
      const task = loadTaskRef.current
      pdfDocRef.current = null
      loadTaskRef.current = null

      if (doc || task) {
        void withPdfLock(() => releasePdfDocument(doc, task))
      }
    }
  }, [book?.id, book?.path])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return

      event.preventDefault()
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
      setZoomLevel((current) =>
        clampZoom(Math.round(current * factor * 100) / 100),
      )
    }

    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [])

  const goToPrevPage = useCallback(() => {
    setPageNum((current) => Math.max(1, current - 1))
  }, [])

  const goToNextPage = useCallback(() => {
    setPageNum((current) => Math.min(numPages, current + 1))
  }, [numPages])

  const goToPage = useCallback(
    (target: number) => {
      if (numPages === 0) return
      setPageNum(Math.min(numPages, Math.max(1, Math.floor(target))))
    },
    [numPages],
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (loading || numPages === 0) return

      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        goToPrevPage()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goToNextPage()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goToPrevPage, goToNextPage, loading, numPages])

  useEffect(() => {
    if (!book || loading || numPages === 0) return
    onProgressChange?.(book.id, { pageNum, zoomLevel })
  }, [book, pageNum, zoomLevel, loading, numPages, onProgressChange])

  return {
    pageNum,
    numPages,
    loading,
    error,
    pdfDoc,
    zoomLevel,
    containerRef,
    handleRenderError,
    goToPrevPage,
    goToNextPage,
    goToPage,
  }
}
