import { randomUUID } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { dialog, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc/channels.ts'
import type { Book } from '../../../shared/types/book.ts'
import type { LibraryState } from '../../../shared/types/library-state.ts'
import {
  loadLibraryState,
  saveLibraryState,
} from '../../services/storage/library-store.ts'

export function registerLibraryHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.LIBRARY_OPEN_PDF, async (): Promise<Book | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const filePath = result.filePaths[0]

    return {
      id: randomUUID(),
      name: path.basename(filePath, path.extname(filePath)),
      path: filePath,
    }
  })

  ipcMain.handle(
    IPC_CHANNELS.LIBRARY_READ_PDF,
    async (_event, filePath: string): Promise<Uint8Array> => {
      await access(filePath)
      const buffer = await readFile(filePath)
      return new Uint8Array(buffer)
    },
  )

  ipcMain.handle(IPC_CHANNELS.LIBRARY_LOAD_STATE, (): Promise<LibraryState> =>
    loadLibraryState(),
  )

  ipcMain.handle(
    IPC_CHANNELS.LIBRARY_SAVE_STATE,
    (_event, state: LibraryState): Promise<void> => saveLibraryState(state),
  )
}
