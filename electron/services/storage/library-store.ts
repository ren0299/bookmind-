import { access, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { Book } from '../../../shared/types/book.ts'
import type { LibraryState } from '../../../shared/types/library-state.ts'

const FILE_NAME = 'library-state.json'

const defaultState: LibraryState = {
  books: [],
  progress: {},
  selectedBookId: null,
}

function getStorePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

async function filterExistingBooks(books: Book[]): Promise<Book[]> {
  const valid: Book[] = []

  for (const book of books) {
    try {
      await access(book.path)
      valid.push(book)
    } catch {
      // 文件已移动或删除，跳过
    }
  }

  return valid
}

export async function loadLibraryState(): Promise<LibraryState> {
  try {
    const raw = await readFile(getStorePath(), 'utf-8')
    const parsed = JSON.parse(raw) as LibraryState
    const books = await filterExistingBooks(parsed.books ?? [])

    const progress: LibraryState['progress'] = {}
    for (const book of books) {
      const saved = parsed.progress?.[book.id]
      if (saved) {
        progress[book.id] = saved
      }
    }

    const selectedBookId = books.some((book) => book.id === parsed.selectedBookId)
      ? parsed.selectedBookId
      : null

    return { books, progress, selectedBookId }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return { ...defaultState }
    throw new Error('读取本地书库数据失败；为保护现有记录，BookMind 未重置书库。', { cause: error })
  }
}

export async function saveLibraryState(state: LibraryState): Promise<void> {
  const destination = getStorePath()
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(state, null, 2), 'utf-8')
  await rename(temporary, destination)
}
