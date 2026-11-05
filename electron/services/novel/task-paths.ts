import path from 'node:path'
import { realpath, rm, rmdir } from 'node:fs/promises'

export interface OwnedNovelPaths {
  taskDirectory: string
  exportDirectory: string | null
  exportFile: string | null
}

export function safeNovelName(name: string): string {
  return [...name].map(character => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '_' : character).join('').slice(0, 100) || 'novel'
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function resolveOwnedNovelPaths(id: string, name: string, outputPath: string | null, userData: string, documents: string): OwnedNovelPaths {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('无效的小说任务 ID。')
  const downloadRoot = path.resolve(userData, 'novel-downloads')
  const taskDirectory = path.resolve(downloadRoot, id)
  if (!isInside(downloadRoot, taskDirectory) || path.dirname(taskDirectory) !== downloadRoot) throw new Error('小说章节目录路径校验失败，未删除任何文件。')
  if (!outputPath) return { taskDirectory, exportDirectory: null, exportFile: null }
  const booksRoot = path.resolve(documents, 'BookMind', 'Books')
  const exportDirectory = path.resolve(booksRoot, `${safeNovelName(name)}-${id.slice(0, 8)}`)
  const exportFile = path.resolve(exportDirectory, `${safeNovelName(name)}.txt`)
  if (path.resolve(outputPath) !== exportFile || !isInside(booksRoot, exportFile)) throw new Error('TXT 文件路径不属于该小说的 BookMind 下载目录，已拒绝删除。')
  return { taskDirectory, exportDirectory, exportFile }
}

export async function removeOwnedNovelArtifacts(paths: OwnedNovelPaths, remove: typeof rm = rm): Promise<void> {
  await assertRealPathInside(path.dirname(paths.taskDirectory), paths.taskDirectory)
  if (paths.exportFile && paths.exportDirectory) await assertRealPathInside(path.dirname(paths.exportDirectory), paths.exportFile)
  await remove(paths.taskDirectory, { recursive: true, force: true })
  if (paths.exportFile) await remove(paths.exportFile, { force: true })
  if (paths.exportDirectory) await rmdir(paths.exportDirectory).catch(error => {
    if (!(error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ENOTEMPTY'].includes(String(error.code)))) throw error
  })
}

async function assertRealPathInside(parent: string, candidate: string): Promise<void> {
  try {
    const [realParent, realCandidate] = await Promise.all([realpath(parent), realpath(candidate)])
    if (!isInside(realParent, realCandidate)) throw new Error('文件实际位置超出该小说的专属目录，已拒绝删除。')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
}
