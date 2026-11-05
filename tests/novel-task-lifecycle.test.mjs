import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { partitionNovelTasks, isNovelTaskArchived } from '../shared/lib/novel-task-state.ts'
import { recoverNovelTaskAfterRestart } from '../electron/services/novel/download-scheduler.ts'
import { removeOwnedNovelArtifacts, resolveOwnedNovelPaths } from '../electron/services/novel/task-paths.ts'

const id = '96c2c500-8610-4a53-82cf-09fa68a88435'
const task = (status, chapterStatuses) => ({
  id, sourceUrl: 'https://example.org/book', name: '测试小说', author: '作者', status,
  outputPath: null, createdAt: '', updatedAt: '',
  chapters: chapterStatuses.map((chapterStatus, index) => ({ id: String(index + 1), title: `第${index + 1}章`, url: `https://example.org/${index + 1}`, status: chapterStatus })),
})

test('only a task with completed status and all successful chapters appears in completed tab', () => {
  const values = [task('completed', ['completed', 'completed']), task('partially-completed', ['completed', 'failed']), task('paused', ['completed', 'retry-wait'])]
  assert.deepEqual(partitionNovelTasks(values).completed.map(item => item.status), ['completed'])
  assert.deepEqual(partitionNovelTasks(values).active.map(item => item.status), ['partially-completed', 'paused'])
  assert.equal(isNovelTaskArchived(task('completed', ['completed', 'failed'])), false)
})

test('restart recovers a fully downloaded task into completed and keeps failed chapters out of archive', () => {
  assert.equal(recoverNovelTaskAfterRestart(task('downloading', ['completed', 'completed'])).status, 'completed')
  assert.equal(recoverNovelTaskAfterRestart(task('completed', ['completed', 'failed'])).status, 'partially-completed')
})

test('deletion path resolution only accepts exact BookMind output paths and task-scoped storage', () => {
  const userData = path.resolve('user-data')
  const documents = path.resolve('documents')
  const valid = path.join(documents, 'BookMind', 'Books', `测试小说-${id.slice(0, 8)}`, '测试小说.txt')
  const owned = resolveOwnedNovelPaths(id, '测试小说', valid, userData, documents)
  assert.equal(owned.taskDirectory, path.join(userData, 'novel-downloads', id))
  assert.equal(owned.exportFile, valid)
  assert.throws(() => resolveOwnedNovelPaths(id, '测试小说', path.resolve('other', 'important.txt'), userData, documents), /已拒绝删除/)
  assert.throws(() => resolveOwnedNovelPaths('../outside', '测试小说', null, userData, documents), /任务 ID/)
})

test('removes only the selected novel TXT and chapter artifacts, preserving neighboring novels', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'bookmind-delete-'))
  try {
    const userData = path.join(root, 'profile')
    const documents = path.join(root, 'documents')
    const selectedTxt = path.join(documents, 'BookMind', 'Books', `测试小说-${id.slice(0, 8)}`, '测试小说.txt')
    const otherTxt = path.join(documents, 'BookMind', 'Books', '另一小说-12345678', '另一小说.txt')
    const selectedChapter = path.join(userData, 'novel-downloads', id, 'chapters', '1.txt')
    const otherChapter = path.join(userData, 'novel-downloads', 'other-task', 'chapters', '1.txt')
    await Promise.all([selectedTxt, otherTxt, selectedChapter, otherChapter].map(async file => {
      await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, 'chapter')
    }))
    const owned = resolveOwnedNovelPaths(id, '测试小说', selectedTxt, userData, documents)
    await removeOwnedNovelArtifacts(owned)
    await assert.rejects(readFile(selectedTxt))
    await assert.rejects(readFile(selectedChapter))
    assert.equal(await readFile(otherTxt, 'utf8'), 'chapter')
    assert.equal(await readFile(otherChapter, 'utf8'), 'chapter')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('filesystem deletion errors propagate so callers can retain task and library records for retry', async () => {
  const paths = resolveOwnedNovelPaths(id, '测试小说', null, path.resolve('user-data'), path.resolve('documents'))
  const failure = Object.assign(new Error('file locked'), { code: 'EPERM' })
  await assert.rejects(removeOwnedNovelArtifacts(paths, async () => { throw failure }), /file locked/)
})
