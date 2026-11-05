import type { Book } from '../../../shared/types/book.ts'
import type { ReadingProgress } from '../../../shared/types/library-state.ts'
import { PdfReader } from '../../features/reader/components/PdfReader.tsx'
import { TxtReader } from '../../features/reader/components/TxtReader.tsx'

interface MainContentProps {
  selectedBook: Book | null
  savedProgress?: ReadingProgress | null
  onProgressChange?: (bookId: string, progress: ReadingProgress) => void
  onAnalyze?: (bookId:string)=>void
}

export function MainContent({
  selectedBook,
  savedProgress,
  onProgressChange,
  onAnalyze,
}: MainContentProps) {
  if (!selectedBook) {
    return (
      <main className="main-content">
        <p className="main-placeholder">请选择一本书</p>
      </main>
    )
  }

  return (
    <main className="main-content main-content--reader">
      {selectedBook.type === 'txt' || selectedBook.path.toLowerCase().endsWith('.txt') ? <TxtReader
        key={selectedBook.id}
        book={selectedBook}
        savedProgress={savedProgress}
        onProgressChange={onProgressChange}
        onAnalyze={onAnalyze}
      /> : <PdfReader
        key={selectedBook.id}
        book={selectedBook}
        savedProgress={savedProgress}
        onProgressChange={onProgressChange}
        onAnalyze={onAnalyze}
      />}
    </main>
  )
}
