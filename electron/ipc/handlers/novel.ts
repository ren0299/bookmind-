import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc/channels.ts'
import type { AiAdapterManualInput, AdapterHtmlKind, DownloadSettingsInput, NovelMetadata, NovelTaskAction } from '../../../shared/types/novel.ts'
import type { AiIntegrationSettingsInput } from '../../../shared/types/novel.ts'
import { getAiIntegrationStatus, getAiModels, listAiProviders, registerAiAdapter, saveAiIntegrationSettings, verifyAiIntegration } from '../../services/novel/ai-adapter-service.ts'
import { importAdapterHtmlFile } from '../../services/novel/ai-adapter-service.ts'
import { openNovelPreview } from '../../services/novel/preview-service.ts'
import {
  controlNovelTask,
  createNovelTask,
  getNovelOutputFolder,
  importNovelTask,
  importNovelTaskChapterHtml,
  listNovelBookChapters,
  listNovelTasks,
  deleteNovelTask,
  parseNovel,
  readNovelChapter,
  getNovelDownloadSettings,
  saveNovelDownloadSettings,
  restoreNovelSiteDefaults,
  resumeNovelSite,
} from '../../services/novel/novel-service.ts'

export function registerNovelHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.NOVEL_PARSE, (_event, url: string) => parseNovel(url))
  ipcMain.handle(IPC_CHANNELS.NOVEL_CREATE_TASK, (_event, metadata: NovelMetadata) => createNovelTask(metadata))
  ipcMain.handle(IPC_CHANNELS.NOVEL_LIST_TASKS, () => listNovelTasks())
  ipcMain.handle(IPC_CHANNELS.NOVEL_DELETE_TASK, (_event, id: string) => deleteNovelTask(id))
  ipcMain.handle(IPC_CHANNELS.NOVEL_TASK_ACTION, (_event, id: string, action: NovelTaskAction) => controlNovelTask(id, action))
  ipcMain.handle(IPC_CHANNELS.NOVEL_IMPORT, (_event, id: string) => importNovelTask(id))
  ipcMain.handle(IPC_CHANNELS.NOVEL_OPEN_FOLDER, async (_event, id: string) => {
    const result = await shell.openPath(await getNovelOutputFolder(id))
    if (result) throw new Error(result)
  })
  ipcMain.handle(IPC_CHANNELS.NOVEL_READ_CHAPTER, (_event, taskId: string, index: number) => readNovelChapter(taskId, index))
  ipcMain.handle(IPC_CHANNELS.NOVEL_IMPORT_CHAPTER_HTML, async (_event, taskId: string, index: number) => {
    const options = { properties: ['openFile'] as Array<'openFile'>, filters: [{ name: '网页 HTML', extensions: ['html', 'htm'] }] }
    const parent = BrowserWindow.getFocusedWindow()
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return importNovelTaskChapterHtml(taskId, index, result.filePaths[0])
  })
  ipcMain.handle(IPC_CHANNELS.NOVEL_LIST_CHAPTERS, (_event, taskId: string) => listNovelBookChapters(taskId))
  ipcMain.handle(IPC_CHANNELS.AI_INTEGRATION_STATUS, () => getAiIntegrationStatus())
  ipcMain.handle(IPC_CHANNELS.AI_INTEGRATION_SAVE, (_event, settings: AiIntegrationSettingsInput) => saveAiIntegrationSettings(settings))
  ipcMain.handle(IPC_CHANNELS.AI_INTEGRATION_VERIFY, (_event, settings?: AiIntegrationSettingsInput) => verifyAiIntegration(settings))
  ipcMain.handle(IPC_CHANNELS.AI_INTEGRATION_MODELS, (_event, provider: string, apiKey?: string) => getAiModels(provider, apiKey))
  ipcMain.handle(IPC_CHANNELS.AI_INTEGRATION_PROVIDERS, () => listAiProviders())
  ipcMain.handle(IPC_CHANNELS.AI_ADAPTER_REGISTER, (_event, url: string, manual?: AiAdapterManualInput) => registerAiAdapter(url, manual))
  ipcMain.handle(IPC_CHANNELS.AI_ADAPTER_IMPORT_HTML, async (_event, kind: AdapterHtmlKind, sourceUrl: string) => {
    if (kind !== 'catalog' && kind !== 'chapter') throw new Error('无效的网页导入类型。')
    const options = { properties: ['openFile'] as Array<'openFile'>, filters: [{ name: '网页 HTML', extensions: ['html', 'htm'] }] }
    const parent = BrowserWindow.getFocusedWindow()
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return importAdapterHtmlFile(kind, sourceUrl, result.filePaths[0])
  })
  ipcMain.handle(IPC_CHANNELS.NOVEL_OPEN_PREVIEW, (_event, url: string) => openNovelPreview(url))
  ipcMain.handle(IPC_CHANNELS.NOVEL_DOWNLOAD_SETTINGS, (_event,host?:string)=>getNovelDownloadSettings(host))
  ipcMain.handle(IPC_CHANNELS.NOVEL_DOWNLOAD_SETTINGS_SAVE, (_event,input:DownloadSettingsInput)=>saveNovelDownloadSettings(input))
  ipcMain.handle(IPC_CHANNELS.NOVEL_SITE_SETTINGS_DEFAULTS, (_event,host:string)=>restoreNovelSiteDefaults(host))
  ipcMain.handle(IPC_CHANNELS.NOVEL_SITE_RESUME, (_event,host:string)=>resumeNovelSite(host))
}
