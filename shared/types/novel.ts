export interface NovelChapter {
  id: string
  title: string
  url: string
  chapterNumber?: number | null
  specialType?: 'numbered' | 'prologue' | 'extra' | 'afterword' | 'other'
  position?: number
  status: 'pending' | 'downloading' | 'retry-wait' | 'completed' | 'failed'
  retryCount?: number
  retryAt?: number
  error?: string
}

export interface NovelTask {
  id: string
  sourceUrl: string
  name: string
  author: string
  chapters: NovelChapter[]
  status: 'ready' | 'downloading' | 'paused' | 'cancelled' | 'partially-completed' | 'completed'
  outputPath: string | null
  error?: string
  createdAt: string
  updatedAt: string
}

export interface DownloadConfigValues {
  concurrency:number
  requestIntervalSeconds:number
  maxRetries:number
  autoRetry:boolean
}
export interface DownloadSiteSettings extends DownloadConfigValues {host:string;source:'global'|'site';pausedReason:string|null;blockedUntil:number}
export interface DownloadSettingsSnapshot {global:DownloadConfigValues;site:DownloadSiteSettings|null}
export interface DownloadSettingsInput extends DownloadConfigValues {host:string}

export interface NovelMetadata {
  sourceUrl: string
  name: string
  author: string
  chapters: Array<Pick<NovelChapter, 'id' | 'title' | 'url' | 'chapterNumber' | 'specialType' | 'position'>>
  catalogIntegrity?: NovelCatalogIntegrity
}

export interface NovelCatalogIntegrity {
  expectedChapterCount?: number
  chapterCount: number
  duplicateLinkCount: number
  duplicateChapterNumberCount: number
  urlTitleMismatchCount: number
  missingChapterNumbers: Array<{ from: number; to: number }>
  outOfOrder: boolean
  complete: boolean
  warnings: string[]
}

export type NovelTaskAction = 'start' | 'pause' | 'resume' | 'cancel' | 'retry'

export interface AiIntegrationSettingsInput {
  provider: string
  model?: string
  apiKey?: string
}

export interface AiIntegrationStatus {
  provider: string
  baseUrl: string
  model: string
  hasApiKey: boolean
  registeredAdapters: Array<{ host: string; name: string; createdAt: string }>
}

export interface AiModelOption { id: string; name: string }
export interface AiProviderOption { id: string; name: string; baseUrl: string; recommendedModel: string }

export interface AiAdapterRegistrationResult {
  host: string
  name: string
  chapterCount: number
  message: string
  metadata?: NovelMetadata
  importedHtml?: boolean
}

export type AdapterHtmlKind = 'catalog' | 'chapter'
export interface AdapterHtmlImport {
  id: string
  kind: AdapterHtmlKind
  fileName: string
  title: string
  htmlLength: number
}
export interface AiAdapterManualInput {
  catalogImportId: string
  chapterImportId: string
  chapterUrl: string
}
