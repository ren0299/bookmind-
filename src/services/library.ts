import type { LibraryState } from '../../shared/types/library-state.ts'
import type { Book } from '../../shared/types/book.ts'
import type { AiAdapterManualInput, AdapterHtmlImport, AdapterHtmlKind, AiAdapterRegistrationResult, AiIntegrationSettingsInput, AiIntegrationStatus, AiModelOption, AiProviderOption, DownloadSettingsInput, DownloadSettingsSnapshot, NovelMetadata, NovelTask, NovelTaskAction } from '../../shared/types/novel.ts'
import type { AiAnalysisAction, AiAnalysisSettings, AiAnalysisWorkspace, AiAnalysisJob, CreateAiAnalysisJobInput } from '../../shared/types/ai-analysis.ts'

export async function openPdfDialog(): Promise<Book | null> {
  return window.bookMind?.openPdfDialog() ?? null
}

export async function loadLibraryState(): Promise<LibraryState> {
  return (
    window.bookMind?.loadLibraryState() ?? {
      books: [],
      progress: {},
      selectedBookId: null,
    }
  )
}

export async function saveLibraryState(state: LibraryState): Promise<void> {
  await window.bookMind?.saveLibraryState(state)
}

export const parseNovel = (url: string) => window.bookMind!.parseNovel(url)
export const createNovelTask = (metadata: NovelMetadata) => window.bookMind!.createNovelTask(metadata)
export const listNovelTasks = () => window.bookMind!.listNovelTasks()
export const deleteNovelTask = (id: string) => window.bookMind!.deleteNovelTask(id)
export const controlNovelTask = (id: string, action: NovelTaskAction) => window.bookMind!.controlNovelTask(id, action)
export const importNovelTask = (id: string) => window.bookMind!.importNovelTask(id)
export const openNovelFolder = (id: string) => window.bookMind!.openNovelFolder(id)
export const readNovelChapter = (taskId: string, index: number) => window.bookMind!.readNovelChapter(taskId, index)
export const importNovelTaskChapterHtml = (taskId: string, index: number) => window.bookMind!.importNovelTaskChapterHtml(taskId, index)
export const listNovelBookChapters = (taskId: string) => window.bookMind!.listNovelBookChapters(taskId)
export const getAiIntegrationStatus = () => window.bookMind!.getAiIntegrationStatus()
export const saveAiIntegrationSettings = (settings: AiIntegrationSettingsInput) => window.bookMind!.saveAiIntegrationSettings(settings)
export const verifyAiIntegration = (settings: AiIntegrationSettingsInput) => window.bookMind!.verifyAiIntegration(settings)
export const getAiModels = (provider: string, apiKey?: string): Promise<AiModelOption[]> => window.bookMind!.getAiModels(provider, apiKey)
export const listAiProviders = (): Promise<AiProviderOption[]> => window.bookMind!.listAiProviders()
export const registerAiNovelAdapter = (url: string, manual?: AiAdapterManualInput): Promise<AiAdapterRegistrationResult> => window.bookMind!.registerAiNovelAdapter(url, manual)
export const importAdapterHtml = (kind: AdapterHtmlKind, sourceUrl: string): Promise<AdapterHtmlImport | null> => window.bookMind!.importAdapterHtml(kind, sourceUrl)
export const openNovelPreview = (url: string): Promise<void> => window.bookMind!.openNovelPreview(url)
export const getNovelDownloadSettings = (host?:string):Promise<DownloadSettingsSnapshot> => window.bookMind!.getNovelDownloadSettings(host)
export const saveNovelDownloadSettings = (settings:DownloadSettingsInput):Promise<DownloadSettingsSnapshot> => window.bookMind!.saveNovelDownloadSettings(settings)
export const restoreNovelSiteDefaults = (host:string):Promise<DownloadSettingsSnapshot> => window.bookMind!.restoreNovelSiteDefaults(host)
export const resumeNovelSite = (host:string):Promise<DownloadSettingsSnapshot> => window.bookMind!.resumeNovelSite(host)
export const getAiAnalysisSettings = ():Promise<AiAnalysisSettings>=>window.bookMind!.getAiAnalysisSettings()
export const saveAiAnalysisSettings = (settings:AiAnalysisSettings):Promise<AiAnalysisSettings>=>window.bookMind!.saveAiAnalysisSettings(settings)
export const getAiAnalysisWorkspace = (bookId:string):Promise<AiAnalysisWorkspace>=>window.bookMind!.getAiAnalysisWorkspace(bookId)
export const createAiAnalysisJob = (input:CreateAiAnalysisJobInput):Promise<AiAnalysisJob>=>window.bookMind!.createAiAnalysisJob(input)
export const controlAiAnalysisJob = (id:string,action:AiAnalysisAction):Promise<AiAnalysisJob>=>window.bookMind!.controlAiAnalysisJob(id,action)
export const retryAiAnalysisChapter = (jobId:string,chapterId:string):Promise<AiAnalysisJob>=>window.bookMind!.retryAiAnalysisChapter(jobId,chapterId)
export const retryAllFailedAiAnalysisChapters = (jobId:string):Promise<AiAnalysisJob>=>window.bookMind!.retryAllFailedAiAnalysisChapters(jobId)
export type { AiIntegrationStatus }

export type { NovelMetadata, NovelTask }
