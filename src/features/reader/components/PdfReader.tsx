import type { Book } from '../../../../shared/types/book.ts'
import type { ReadingProgress } from '../../../../shared/types/library-state.ts'
import { usePdfReader } from '../hooks/usePdfReader.ts'
import { PdfPageView } from './PdfPageView.tsx'
import { ReaderControls } from './ReaderControls.tsx'

interface PdfReaderProps {
  book: Book
  savedProgress?: ReadingProgress | null
  onProgressChange?: (bookId: string, progress: ReadingProgress) => void
  onAnalyze?: (bookId:string)=>void
}

export function PdfReader({
  book,
  savedProgress,
  onProgressChange,
  onAnalyze,
}: PdfReaderProps) {
  const {
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
  } = usePdfReader(book, savedProgress, onProgressChange)

  return (
    <div className="reader">
      <div className="reader-toolbar"><strong>{book.name}</strong><button className="subtle-action" onClick={()=>onAnalyze?.(book.id)}>AI 分析</button></div>
      <div className="reader-viewport" ref={containerRef}>
        {loading && <p className="reader-status">加载中…</p>}
        {error && <p className="reader-status reader-status--error">{error}</p>}
        {pdfDoc && !loading && (
          <PdfPageView
            key={book.id}
            document={pdfDoc}
            pageNum={pageNum}
            zoomLevel={zoomLevel}
            containerRef={containerRef}
            onError={handleRenderError}
          />
        )}
      </div>
      <ReaderControls
        pageNum={pageNum}
        numPages={numPages}
        onPrev={goToPrevPage}
        onNext={goToNextPage}
        onGoToPage={goToPage}
        disabled={loading || !!error}
      />
    </div>
  )
}
