import type { Book } from '../../../shared/types/book.ts'
import { BookList } from '../../features/library/components/BookList.tsx'
import { ImportPdfButton } from '../../features/library/components/ImportPdfButton.tsx'

interface SidebarProps {
  books: Book[]
  selectedBookId: string | null
  onSelect: (bookId: string) => void
  onRemove: (bookId: string) => void
  onImport: () => void
  showDownloader: boolean
  onShowDownloader: () => void
  showAiWorkbench:boolean
  onShowAiWorkbench:()=>void
}

export function Sidebar({
  books,
  selectedBookId,
  onSelect,
  onRemove,
  onImport,
  showDownloader,
  onShowDownloader,
  showAiWorkbench,
  onShowAiWorkbench,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-books">
        <BookList
          books={books}
          selectedBookId={selectedBookId}
          onSelect={onSelect}
          onRemove={onRemove}
        />
      </div>
      <div className="sidebar-footer">
        <button type="button" className={`novel-nav-btn${showDownloader ? ' novel-nav-btn--active' : ''}`} onClick={onShowDownloader}>小说下载</button>
        <button type="button" className={`novel-nav-btn${showAiWorkbench ? ' novel-nav-btn--active' : ''}`} onClick={onShowAiWorkbench}>AI 工作台</button>
        <ImportPdfButton onClick={onImport} />
      </div>
    </aside>
  )
}
