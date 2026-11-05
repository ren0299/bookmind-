import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book } from '../../../../shared/types/book.ts'
import type { ReadingProgress } from '../../../../shared/types/library-state.ts'
import { DEFAULT_ZOOM } from '../../../lib/pdf.ts'
import {
  importNovelTask,
  loadLibraryState,
  openPdfDialog,
  saveLibraryState,
} from '../../../services/library.ts'

export function useLibrary() {
  const [books, setBooks] = useState<Book[]>([])
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null)
  const [progress, setProgress] = useState<Record<string, ReadingProgress>>({})
  const [hydrated, setHydrated] = useState(false)
  const libraryLoadRef = useRef<ReturnType<typeof loadLibraryState> | null>(null)
  const progressRef = useRef(progress)

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  const selectedBook = useMemo(
    () => books.find((book) => book.id === selectedBookId) ?? null,
    [books, selectedBookId],
  )

  const selectedProgress = selectedBookId
    ? (progress[selectedBookId] ?? null)
    : null

  useEffect(() => {
    const loading = loadLibraryState()
    libraryLoadRef.current = loading
    loading.then((state) => {
      setBooks(state.books)
      setProgress(state.progress)
      setSelectedBookId(state.selectedBookId)
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    if (!hydrated) return

    const timer = window.setTimeout(() => {
      void saveLibraryState({
        books,
        progress,
        selectedBookId,
      })
    }, 400)

    return () => window.clearTimeout(timer)
  }, [books, progress, selectedBookId, hydrated])

  const importPdf = useCallback(async () => {
    const book = await openPdfDialog()
    if (!book) return

    setBooks((prev) => {
      const existing = prev.find((item) => item.path === book.path)
      if (existing) {
        setSelectedBookId(existing.id)
        return prev
      }
      setSelectedBookId(book.id)
      return [...prev, book]
    })
  }, [])

  const importDownloadedNovel = useCallback(async (taskId: string) => {
    if (!hydrated) await libraryLoadRef.current
    const book = await importNovelTask(taskId)
    setBooks((prev) => {
      const existing = prev.find((item) => item.path === book.path)
      if (existing) {
        setSelectedBookId(existing.id)
        return prev
      }
      setSelectedBookId(book.id)
      return [...prev, book]
    })
    return book
  }, [hydrated])

  const selectBook = useCallback((bookId: string) => {
    setSelectedBookId(bookId)
  }, [])

  const removeBook = useCallback((bookId: string) => {
    setBooks((prevBooks) => {
      const nextBooks = prevBooks.filter((book) => book.id !== bookId)
      setSelectedBookId((current) =>
        current === bookId ? (nextBooks[0]?.id ?? null) : current,
      )
      return nextBooks
    })

    setProgress((prev) => {
      if (!(bookId in prev)) return prev
      const next = { ...prev }
      delete next[bookId]
      return next
    })
  }, [])

  const removeNovelBook = useCallback((taskId: string) => {
    const removedIds = new Set(books.filter((book) => book.novelTaskId === taskId).map((book) => book.id))
    const next = books.filter((book) => book.novelTaskId !== taskId)
    setBooks(next)
    setSelectedBookId((current) => current && removedIds.has(current) ? (next[0]?.id ?? null) : current)
    setProgress((saved) => Object.fromEntries(Object.entries(saved).filter(([bookId]) => !removedIds.has(bookId))))
  }, [books])

  const updateProgress = useCallback(
    (bookId: string, next: ReadingProgress) => {
      const current = progressRef.current[bookId]
      if (
        current?.pageNum === next.pageNum &&
        current?.zoomLevel === next.zoomLevel
      ) {
        return
      }

      setProgress((prev) => ({ ...prev, [bookId]: next }))
    },
    [],
  )

  const handleProgressChange = useCallback(
    (bookId: string, next: ReadingProgress) => {
      updateProgress(bookId, next)
    },
    [updateProgress],
  )

  return {
    books,
    selectedBookId,
    selectedBook,
    selectedProgress,
    importPdf,
    importDownloadedNovel,
    selectBook,
    removeBook,
    removeNovelBook,
    handleProgressChange,
    defaultProgress: { pageNum: 1, zoomLevel: DEFAULT_ZOOM } as ReadingProgress,
  }
}
