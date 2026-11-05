import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/ipc/channels.ts'
import type { AiAnalysisAction, AiAnalysisSettings, CreateAiAnalysisJobInput } from '../../../shared/types/ai-analysis.ts'
import { controlAiAnalysisJob, createAiAnalysisJob, getAiAnalysisSettings, getAiAnalysisWorkspace, retryAiAnalysisChapter, retryAllFailedAiAnalysisChapters, saveAiAnalysisSettings } from '../../services/ai-analysis-service.ts'

export function registerAiAnalysisHandlers():void{
  ipcMain.handle(IPC_CHANNELS.AI_ANALYSIS_SETTINGS_GET,()=>getAiAnalysisSettings())
  ipcMain.handle(IPC_CHANNELS.AI_ANALYSIS_SETTINGS_SAVE,(_event,settings:AiAnalysisSettings)=>saveAiAnalysisSettings(settings))
  ipcMain.handle(IPC_CHANNELS.AI_ANALYSIS_WORKSPACE,(_event,bookId:string)=>getAiAnalysisWorkspace(bookId))
  ipcMain.handle(IPC_CHANNELS.AI_ANALYSIS_JOB_CREATE,(_event,input:CreateAiAnalysisJobInput)=>createAiAnalysisJob(input))
  ipcMain.handle(IPC_CHANNELS.AI_ANALYSIS_JOB_ACTION,(_event,id:string,action:AiAnalysisAction)=>controlAiAnalysisJob(id,action))
  ipcMain.handle(IPC_CHANNELS.AI_ANALYSIS_CHAPTER_RETRY,(_event,jobId:string,chapterId:string)=>retryAiAnalysisChapter(jobId,chapterId))
  ipcMain.handle(IPC_CHANNELS.AI_ANALYSIS_RETRY_FAILED,(_event,jobId:string)=>retryAllFailedAiAnalysisChapters(jobId))
}
