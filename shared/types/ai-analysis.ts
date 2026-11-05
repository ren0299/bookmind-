export type AiAnalysisJobStatus = 'queued' | 'running' | 'paused' | 'cancelled' | 'completed' | 'partial'
export type AiChapterAnalysisStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type AiAnalysisAction = 'pause' | 'resume' | 'cancel'

export interface AiAnalysisChapterRef {
  id: string
  title: string
  chapterNumber: number | null
  position: number
  status: 'completed' | 'failed' | 'pending'
}

export interface AiAnalysisBook {
  id: string
  name: string
  author?: string
  type?: 'pdf' | 'txt'
  novelTaskId?: string
  chapterCount: number
  supported: boolean
  unsupportedReason?: string
}

export interface AiAnalysisSettings {
  concurrency: number
}

export interface AiAnalysisJob {
  id: string
  bookId: string
  bookName: string
  novelTaskId: string
  status: AiAnalysisJobStatus
  model: string
  concurrency: number
  totalChapters: number
  analyzedChapters: number
  failedChapters: number
  pendingChapters: number
  failedChapterIds: string[]
  currentChapterId: string | null
  currentChapterTitle: string | null
  startChapterNumber: number | null
  endChapterNumber: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

export interface AiChapterSummary {
  bookId: string
  chapterId: string
  chapterNumber: number | null
  position: number
  chapterTitle: string
  summary: string | null
  keyEvents: string[]
  characters: string[]
  characterChanges: Array<{ character: string; change: string }>
  importantFacts: string[]
  clues: string[]
  model: string
  analyzedAt: string | null
  status: AiChapterAnalysisStatus
  promptTokens: number | null
  candidateTokens: number | null
  totalTokens: number | null
  error: string | null
}

export interface AiAnalysisWorkspace {
  book: AiAnalysisBook
  chapters: AiAnalysisChapterRef[]
  jobs: AiAnalysisJob[]
  summaries: AiChapterSummary[]
}

export interface CreateAiAnalysisJobInput {
  bookId: string
  startChapterNumber?: number
  endChapterNumber?: number
}

export interface GeminiChapterAnalysis {
  chapter_number: number | null
  chapter_title: string
  summary: string
  key_events: string[]
  characters: string[]
  character_changes: Array<{ character: string; change: string }>
  important_facts: string[]
  clues: string[]
}

export interface AiTokenUsage {
  promptTokens: number | null
  candidateTokens: number | null
  totalTokens: number | null
}
