import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc/channels.ts'
import type { Book } from '../shared/types/book.ts'
import type { LibraryState } from '../shared/types/library-state.ts'
import type { AiAnalysisAction, AiAnalysisSettings, AiAnalysisWorkspace, AiAnalysisJob, CreateAiAnalysisJobInput } from '../shared/types/ai-analysis.ts'
import type { AiAdapterManualInput, AdapterHtmlImport, AdapterHtmlKind, AiAdapterRegistrationResult, AiIntegrationSettingsInput, AiIntegrationStatus, AiModelOption, AiProviderOption, DownloadSettingsInput, DownloadSettingsSnapshot, NovelMetadata, NovelTask, NovelTaskAction } from '../shared/types/novel.ts'

contextBridge.exposeInMainWorld('bookMind', {
  openPdfDialog: (): Promise<Book | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_OPEN_PDF),
  readPdf: (filePath: string): Promise<Uint8Array> =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_READ_PDF, filePath),
  loadLibraryState: (): Promise<LibraryState> =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_LOAD_STATE),
  saveLibraryState: (state: LibraryState): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_SAVE_STATE, state),
  parseNovel: (url: string): Promise<NovelMetadata> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_PARSE, url),
  createNovelTask: (metadata: NovelMetadata): Promise<NovelTask> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_CREATE_TASK, metadata),
  listNovelTasks: (): Promise<NovelTask[]> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_LIST_TASKS),
  deleteNovelTask: (id: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_DELETE_TASK, id),
  controlNovelTask: (id: string, action: NovelTaskAction): Promise<NovelTask> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_TASK_ACTION, id, action),
  importNovelTask: (id: string): Promise<Book> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_IMPORT, id),
  openNovelFolder: (id: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_OPEN_FOLDER, id),
  readNovelChapter: (taskId: string, index: number): Promise<{ title: string; content: string }> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_READ_CHAPTER, taskId, index),
  importNovelTaskChapterHtml: (taskId: string, index: number): Promise<NovelTask | null> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_IMPORT_CHAPTER_HTML, taskId, index),
  listNovelBookChapters: (taskId: string): Promise<Array<{ title: string }>> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_LIST_CHAPTERS, taskId),
  getAiIntegrationStatus: (): Promise<AiIntegrationStatus> => ipcRenderer.invoke(IPC_CHANNELS.AI_INTEGRATION_STATUS),
  saveAiIntegrationSettings: (settings: AiIntegrationSettingsInput): Promise<AiIntegrationStatus> => ipcRenderer.invoke(IPC_CHANNELS.AI_INTEGRATION_SAVE, settings),
  verifyAiIntegration: (settings: AiIntegrationSettingsInput): Promise<{ message: string; model: string }> => ipcRenderer.invoke(IPC_CHANNELS.AI_INTEGRATION_VERIFY, settings),
  getAiModels: (provider: string, apiKey?: string): Promise<AiModelOption[]> => ipcRenderer.invoke(IPC_CHANNELS.AI_INTEGRATION_MODELS, provider, apiKey),
  listAiProviders: (): Promise<AiProviderOption[]> => ipcRenderer.invoke(IPC_CHANNELS.AI_INTEGRATION_PROVIDERS),
  registerAiNovelAdapter: (url: string, manual?: AiAdapterManualInput): Promise<AiAdapterRegistrationResult> => ipcRenderer.invoke(IPC_CHANNELS.AI_ADAPTER_REGISTER, url, manual),
  importAdapterHtml: (kind: AdapterHtmlKind, sourceUrl: string): Promise<AdapterHtmlImport | null> => ipcRenderer.invoke(IPC_CHANNELS.AI_ADAPTER_IMPORT_HTML, kind, sourceUrl),
  openNovelPreview: (url: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.NOVEL_OPEN_PREVIEW, url),
  getNovelDownloadSettings: (host?:string):Promise<DownloadSettingsSnapshot>=>ipcRenderer.invoke(IPC_CHANNELS.NOVEL_DOWNLOAD_SETTINGS,host),
  saveNovelDownloadSettings: (settings:DownloadSettingsInput):Promise<DownloadSettingsSnapshot>=>ipcRenderer.invoke(IPC_CHANNELS.NOVEL_DOWNLOAD_SETTINGS_SAVE,settings),
  restoreNovelSiteDefaults: (host:string):Promise<DownloadSettingsSnapshot>=>ipcRenderer.invoke(IPC_CHANNELS.NOVEL_SITE_SETTINGS_DEFAULTS,host),
  resumeNovelSite: (host:string):Promise<DownloadSettingsSnapshot>=>ipcRenderer.invoke(IPC_CHANNELS.NOVEL_SITE_RESUME,host),
  getAiAnalysisSettings: ():Promise<AiAnalysisSettings>=>ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYSIS_SETTINGS_GET),
  saveAiAnalysisSettings: (settings:AiAnalysisSettings):Promise<AiAnalysisSettings>=>ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYSIS_SETTINGS_SAVE,settings),
  getAiAnalysisWorkspace: (bookId:string):Promise<AiAnalysisWorkspace>=>ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYSIS_WORKSPACE,bookId),
  createAiAnalysisJob: (input:CreateAiAnalysisJobInput):Promise<AiAnalysisJob>=>ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYSIS_JOB_CREATE,input),
  controlAiAnalysisJob: (id:string,action:AiAnalysisAction):Promise<AiAnalysisJob>=>ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYSIS_JOB_ACTION,id,action),
  retryAiAnalysisChapter: (jobId:string,chapterId:string):Promise<AiAnalysisJob>=>ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYSIS_CHAPTER_RETRY,jobId,chapterId),
  retryAllFailedAiAnalysisChapters: (jobId:string):Promise<AiAnalysisJob>=>ipcRenderer.invoke(IPC_CHANNELS.AI_ANALYSIS_RETRY_FAILED,jobId),
})
