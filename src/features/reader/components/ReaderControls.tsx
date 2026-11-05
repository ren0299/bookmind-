import { useEffect, useState } from 'react'

interface ReaderControlsProps {
  pageNum: number
  numPages: number
  onPrev: () => void
  onNext: () => void
  onGoToPage: (page: number) => void
  disabled?: boolean
}

export function ReaderControls({
  pageNum,
  numPages,
  onPrev,
  onNext,
  onGoToPage,
  disabled = false,
}: ReaderControlsProps) {
  const [pageInput, setPageInput] = useState(String(pageNum))
  const [isEditing, setIsEditing] = useState(false)

  const atFirst = pageNum <= 1
  const atLast = numPages === 0 || pageNum >= numPages

  useEffect(() => {
    if (!isEditing) {
      setPageInput(String(numPages > 0 ? pageNum : 0))
    }
  }, [pageNum, numPages, isEditing])

  function commitPageInput() {
    setIsEditing(false)
    const parsed = Number.parseInt(pageInput, 10)
    if (Number.isNaN(parsed)) {
      setPageInput(String(pageNum))
      return
    }
    onGoToPage(parsed)
  }

  return (
    <footer className="reader-controls">
      <button
        type="button"
        className="reader-nav-btn"
        onClick={onPrev}
        disabled={disabled || atFirst}
      >
        上一页
      </button>
      <span className="reader-page-info">
        第{' '}
        <input
          type="text"
          inputMode="numeric"
          className="reader-page-input"
          value={pageInput}
          disabled={disabled || numPages === 0}
          aria-label="当前页码"
          onFocus={() => setIsEditing(true)}
          onChange={(event) => setPageInput(event.target.value)}
          onBlur={commitPageInput}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitPageInput()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setPageInput(String(pageNum))
              setIsEditing(false)
              event.currentTarget.blur()
            }
          }}
        />{' '}
        / {numPages} 页
      </span>
      <button
        type="button"
        className="reader-nav-btn"
        onClick={onNext}
        disabled={disabled || atLast}
      >
        下一页
      </button>
    </footer>
  )
}
