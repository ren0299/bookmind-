import type { Book } from './book.ts'

export interface ReadingProgress {
  pageNum: number
  zoomLevel: number
}

export interface LibraryState {
  books: Book[]
  progress: Record<string, ReadingProgress>
  selectedBookId: string | null
}
