import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_DOWNLOAD_CONFIG,
  SiteRequestScheduler,
  NovelDownloadError,
  classifyDownloadFailure,
  defaultPersistedSettings,
  effectiveSiteConfig,
  isChapterEligible,
  normalizeSiteHost,
  readPersistedDownloadSettings,
  recoverNovelTaskAfterRestart,
  retryAfterMilliseconds,
  retryDelayMs,
  validateConfig,
  writePersistedDownloadSettings,
} from '../electron/services/novel/download-scheduler.ts'

test('accepts concurrency from 1 to 10 and request intervals from 0 to 5 seconds', () => {
  for (let concurrency = 1; concurrency <= 10; concurrency += 1) {
    assert.equal(validateConfig({ ...DEFAULT_DOWNLOAD_CONFIG, concurrency }).concurrency, concurrency)
  }
  for (let requestIntervalSeconds = 0; requestIntervalSeconds <= 5; requestIntervalSeconds += 1) {
    assert.equal(validateConfig({ ...DEFAULT_DOWNLOAD_CONFIG, requestIntervalSeconds }).requestIntervalSeconds, requestIntervalSeconds)
  }
  assert.throws(() => validateConfig({ ...DEFAULT_DOWNLOAD_CONFIG, concurrency: 11 }), /1～10/)
  assert.throws(() => validateConfig({ ...DEFAULT_DOWNLOAD_CONFIG, requestIntervalSeconds: 6 }), /0～5/)
})

test('defaults to two workers and canonicalizes equivalent www hostnames', () => {
  assert.equal(DEFAULT_DOWNLOAD_CONFIG.concurrency, 2)
  assert.equal(normalizeSiteHost('WWW.TwKan.Com.'), 'twkan.com')
  assert.equal(effectiveSiteConfig(defaultPersistedSettings(), 'www.twkan.com').concurrency, 2)
})

test('keeps different website settings independent and global changes do not replace overrides', () => {
  const settings = defaultPersistedSettings()
  settings.sites['twkan.com'] = { concurrency: 5, requestIntervalSeconds: 2, maxRetries: 1, autoRetry: false }
  settings.sites['gutenberg.org'] = { concurrency: 1, requestIntervalSeconds: 4, maxRetries: 4, autoRetry: true }
  settings.global = { concurrency: 3, requestIntervalSeconds: 3, maxRetries: 2, autoRetry: true }
  assert.equal(effectiveSiteConfig(settings, 'm.twkan.com').concurrency, 5)
  assert.equal(effectiveSiteConfig(settings, 'twkan.com').concurrency, 5)
  assert.equal(effectiveSiteConfig(settings, 'gutenberg.org').concurrency, 1)
})

test('enforces a shared per-site concurrency cap across independent task workers', async () => {
  const scheduler = new SiteRequestScheduler()
  let active = 0
  let maximum = 0
  await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const release = await scheduler.acquire('twkan.com', `https://twkan.com/chapter/${index}`, { concurrency: 2, requestIntervalSeconds: 0 })
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 15))
    active -= 1
    release()
  }))
  assert.equal(maximum, 2)
})

test('a chapter failure releases its site lease so remaining workers continue', async () => {
  const scheduler = new SiteRequestScheduler()
  const queue = ['one', 'two', 'three', 'four']
  const completed = []
  let next = 0
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < queue.length) {
      const item = queue[next++]
      const release = await scheduler.acquire('example.org', `https://example.org/${item}`, { concurrency: 2, requestIntervalSeconds: 0 })
      try {
        if (item === 'one') throw new NovelDownloadError('network', 'temporary network error')
        completed.push(item)
      } catch { /* only this item fails; this worker keeps claiming work */ }
      finally { release() }
    }
  }))
  assert.deepEqual(completed.sort(), ['four', 'three', 'two'])
})

test('uses the configured incremental retry delays and classifies HTTP response types', () => {
  assert.deepEqual([retryDelayMs(0), retryDelayMs(1), retryDelayMs(2)], [5_000, 15_000, 30_000])
  assert.equal(classifyDownloadFailure(new Error('socket timeout')).kind, 'network')
  assert.equal(classifyDownloadFailure(new Error('HTTP 503')).kind, 'server')
  assert.equal(classifyDownloadFailure(new Error('正文选择器没有匹配内容')).kind, 'parse')
})

test('honors Retry-After as delta seconds or an HTTP date', () => {
  assert.equal(retryAfterMilliseconds('12', 0), 12_000)
  assert.equal(retryAfterMilliseconds('Thu, 01 Jan 1970 00:00:20 GMT', 10_000), 10_000)
})

test('a 429 Retry-After blocks later requests to that site but not to other sites', async () => {
  const scheduler = new SiteRequestScheduler()
  const blockedUntil = Date.now() + 45
  scheduler.blockUntil('twkan.com', blockedUntil)
  const otherSiteStart = Date.now()
  const otherRelease = await scheduler.acquire('gutenberg.org', 'https://gutenberg.org/next', { concurrency: 2, requestIntervalSeconds: 0 })
  otherRelease()
  const started = Date.now()
  const release = await scheduler.acquire('twkan.com', 'https://twkan.com/next', { concurrency: 2, requestIntervalSeconds: 0 })
  release()
  assert.ok(Date.now() - started >= 30)
  assert.ok(otherSiteStart <= started)
})

test('403 and Cloudflare challenges pause one site while other sites keep working', async () => {
  const scheduler = new SiteRequestScheduler()
  const failure = classifyDownloadFailure(new Error('Cloudflare challenge (HTTP 403)'))
  assert.equal(failure.kind, 'access')
  scheduler.pauseSite('twkan.com', 'Cloudflare challenge')
  await assert.rejects(scheduler.acquire('twkan.com', 'https://twkan.com/1', { concurrency: 2, requestIntervalSeconds: 0 }), /已暂停/)
  scheduler.resumeSite('twkan.com')
  const resumed = await scheduler.acquire('twkan.com', 'https://twkan.com/1', { concurrency: 2, requestIntervalSeconds: 0 })
  resumed()
  const release = await scheduler.acquire('gutenberg.org', 'https://gutenberg.org/1', { concurrency: 2, requestIntervalSeconds: 0 })
  release()
})

test('does not request the same chapter URL concurrently', async () => {
  const scheduler = new SiteRequestScheduler()
  const url = 'https://example.org/chapter/1'
  const first = await scheduler.acquire('example.org', url, { concurrency: 2, requestIntervalSeconds: 0 })
  let secondAcquired = false
  const secondPromise = scheduler.acquire('www.example.org', url, { concurrency: 2, requestIntervalSeconds: 0 }).then(release => { secondAcquired = true; return release })
  await new Promise(resolve => setTimeout(resolve, 25))
  assert.equal(secondAcquired, false)
  first()
  const second = await secondPromise
  second()
})

test('persists site settings and pause state across reloads without affecting other domains', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bookmind-settings-'))
  const filename = path.join(directory, 'download-settings.json')
  try {
    const settings = defaultPersistedSettings()
    settings.sites['twkan.com'] = { concurrency: 4, requestIntervalSeconds: 2, maxRetries: 3, autoRetry: true }
    settings.siteStates['twkan.com'] = { pausedReason: 'HTTP 403' }
    await writePersistedDownloadSettings(filename, settings)
    const restored = await readPersistedDownloadSettings(filename)
    assert.equal(effectiveSiteConfig(restored, 'twkan.com').concurrency, 4)
    assert.equal(restored.siteStates['twkan.com'].pausedReason, 'HTTP 403')
    assert.equal(restored.siteStates['gutenberg.org'], undefined)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('restart recovery preserves completed chapters and resumes incomplete progress without refetching successes', () => {
  const task = {
    id: 'task', sourceUrl: 'https://example.org/book', name: 'Test', author: 'A', status: 'downloading', outputPath: null,
    createdAt: '', updatedAt: '', chapters: [
      { id: '1', title: '第1章', url: 'https://example.org/1', status: 'completed' },
      { id: '2', title: '第2章', url: 'https://example.org/2', status: 'downloading' },
      { id: '3', title: '第3章', url: 'https://example.org/3', status: 'retry-wait', retryCount: 1, retryAt: Date.now() + 5000 },
    ],
  }
  const recovered = recoverNovelTaskAfterRestart(task)
  assert.equal(recovered.status, 'paused')
  assert.equal(recovered.chapters[0].status, 'completed')
  assert.equal(recovered.chapters[1].status, 'pending')
  assert.equal(recovered.chapters[2].status, 'retry-wait')
  assert.equal(isChapterEligible(recovered.chapters[0], false, Date.now()), false)
  assert.equal(isChapterEligible(recovered.chapters[1], false, Date.now()), true)
})

test('does not leak a paused site state to another normalized domain', () => {
  const scheduler = new SiteRequestScheduler()
  scheduler.pauseSite('twkan.com', 'manual confirmation required')
  assert.equal(scheduler.siteStatus('www.twkan.com').pausedReason, 'manual confirmation required')
  assert.equal(scheduler.siteStatus('gutenberg.org').pausedReason, null)
})
