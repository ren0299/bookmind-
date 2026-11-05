import type { Book } from '../../../../shared/types/book.ts'

interface BookListProps {
  books: Book[]
  selectedBookId: string | null
  onSelect: (bookId: string) => void
  onRemove: (bookId: string) => void
}

export function BookList({
  books,
  selectedBookId,
  onSelect,
  onRemove,
}: BookListProps) {
  if (books.length === 0) {
    return <p className="sidebar-empty">暂无书籍</p>
  }

  return (
    <ul className="book-list">
      {books.map((book) => (
        <li key={book.id} className="book-list-row">
          <button
            type="button"
            className={`book-list-item${book.id === selectedBookId ? ' book-list-item--active' : ''}`}
            onClick={() => onSelect(book.id)}
          >
            <span className="book-list-icon" aria-hidden="true">
              {book.type === 'txt' || book.path.toLowerCase().endsWith('.txt') ? 'TXT' : 'PDF'}
            </span>
            <span className="book-list-name" title={book.name}>
              {book.name}
            </span>
          </button>
          <button
            type="button"
            className="book-list-remove"
            aria-label={`从书架移除 ${book.name}`}
            title="从书架移除"
            onClick={() => onRemove(book.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}
