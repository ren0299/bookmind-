import { registerLibraryHandlers } from './handlers/library.ts'
import { registerNovelHandlers } from './handlers/novel.ts'
import { registerAiAnalysisHandlers } from './handlers/ai-analysis.ts'

export function registerIpcHandlers(): void {
  registerLibraryHandlers()
  registerNovelHandlers()
  registerAiAnalysisHandlers()
}
