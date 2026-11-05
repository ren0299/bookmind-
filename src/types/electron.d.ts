import type { Book } from '../../shared/types/book.ts'
import type { LibraryState, ReadingProgress } from '../../shared/types/library-state.ts'
import type { AiAnalysisAction, AiAnalysisSettings, AiAnalysisWorkspace, AiAnalysisJob, CreateAiAnalysisJobInput } from '../../shared/types/ai-analysis.ts'
import type { AiAdapterManualInput, AdapterHtmlImport, AdapterHtmlKind, AiAdapterRegistrationResult, AiIntegrationSettingsInput, AiIntegrationStatus, AiModelOption, AiProviderOption, DownloadSettingsInput, DownloadSettingsSnapshot, NovelMetadata, NovelTask, NovelTaskAction } from '../../shared/types/novel.ts'

export interface BookMindAPI {
  openPdfDialog: () => Promise<Book | null>
  readPdf: (filePath: string) => Promise<Uint8Array>
  loadLibraryState: () => Promise<LibraryState>
  saveLibraryState: (state: LibraryState) => Promise<void>
  parseNovel: (url: string) => Promise<NovelMetadata>
  createNovelTask: (metadata: NovelMetadata) => Promise<NovelTask>
  listNovelTasks: () => Promise<NovelTask[]>
  deleteNovelTask: (id: string) => Promise<void>
  controlNovelTask: (id: string, action: NovelTaskAction) => Promise<NovelTask>
  importNovelTask: (id: string) => Promise<Book>
  openNovelFolder: (id: string) => Promise<void>
  readNovelChapter: (taskId: string, index: number) => Promise<{ title: string; content: string }>
  importNovelTaskChapterHtml: (taskId: string, index: number) => Promise<NovelTask | null>
  listNovelBookChapters: (taskId: string) => Promise<Array<{ title: string }>>
  getAiIntegrationStatus: () => Promise<AiIntegrationStatus>
  saveAiIntegrationSettings: (settings: AiIntegrationSettingsInput) => Promise<AiIntegrationStatus>
  verifyAiIntegration: (settings: AiIntegrationSettingsInput) => Promise<{ message: string; model: string }>
  getAiModels: (provider: string, apiKey?: string) => Promise<AiModelOption[]>
  listAiProviders: () => Promise<AiProviderOption[]>
  registerAiNovelAdapter: (url: string, manual?: AiAdapterManualInput) => Promise<AiAdapterRegistrationResult>
  importAdapterHtml: (kind: AdapterHtmlKind, sourceUrl: string) => Promise<AdapterHtmlImport | null>
  openNovelPreview: (url: string) => Promise<void>
  getNovelDownloadSettings: (host?:string)=>Promise<DownloadSettingsSnapshot>
  saveNovelDownloadSettings: (settings:DownloadSettingsInput)=>Promise<DownloadSettingsSnapshot>
  restoreNovelSiteDefaults: (host:string)=>Promise<DownloadSettingsSnapshot>
  resumeNovelSite: (host:string)=>Promise<DownloadSettingsSnapshot>
  getAiAnalysisSettings: ()=>Promise<AiAnalysisSettings>
  saveAiAnalysisSettings: (settings:AiAnalysisSettings)=>Promise<AiAnalysisSettings>
  getAiAnalysisWorkspace: (bookId:string)=>Promise<AiAnalysisWorkspace>
  createAiAnalysisJob: (input:CreateAiAnalysisJobInput)=>Promise<AiAnalysisJob>
  controlAiAnalysisJob: (id:string,action:AiAnalysisAction)=>Promise<AiAnalysisJob>
  retryAiAnalysisChapter: (jobId:string,chapterId:string)=>Promise<AiAnalysisJob>
  retryAllFailedAiAnalysisChapters: (jobId:string)=>Promise<AiAnalysisJob>
}

declare global {
  interface Window {
    bookMind?: BookMindAPI
  }
}

export type { ReadingProgress }
