import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { AiAnalysisSettings } from '../../../shared/types/ai-analysis.ts'

export class AiAnalysisStore {
  readonly database: DatabaseSync

  constructor(filePath: string) {
    mkdirSync(path.dirname(filePath), { recursive: true })
    this.database = new DatabaseSync(filePath)
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS ai_analysis_jobs (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        book_name TEXT NOT NULL,
        novel_task_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued','running','paused','cancelled','completed','partial')),
        model TEXT NOT NULL,
        concurrency INTEGER NOT NULL DEFAULT 2 CHECK (concurrency BETWEEN 1 AND 10),
        start_chapter_number INTEGER,
        end_chapter_number INTEGER,
        current_chapter_id TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_analysis_jobs_book_created ON ai_analysis_jobs(book_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ai_analysis_job_chapters (
        job_id TEXT NOT NULL REFERENCES ai_analysis_jobs(id) ON DELETE CASCADE,
        chapter_id TEXT NOT NULL,
        chapter_number INTEGER,
        chapter_title TEXT NOT NULL,
        chapter_position INTEGER NOT NULL DEFAULT 0,
        position INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(job_id, chapter_id)
      );
      CREATE INDEX IF NOT EXISTS ai_analysis_job_chapters_status ON ai_analysis_job_chapters(job_id, status, position);
      CREATE TABLE IF NOT EXISTS chapter_summaries (
        id TEXT PRIMARY KEY,
        book_id TEXT NOT NULL,
        chapter_id TEXT NOT NULL,
        chapter_number INTEGER,
        chapter_position INTEGER NOT NULL DEFAULT 0,
        chapter_title TEXT NOT NULL,
        summary TEXT,
        key_events_json TEXT NOT NULL DEFAULT '[]',
        characters_json TEXT NOT NULL DEFAULT '[]',
        character_changes_json TEXT NOT NULL DEFAULT '[]',
        important_facts_json TEXT NOT NULL DEFAULT '[]',
        clues_json TEXT NOT NULL DEFAULT '[]',
        model TEXT NOT NULL,
        analyzed_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
        prompt_tokens INTEGER,
        candidate_tokens INTEGER,
        total_tokens INTEGER,
        error TEXT,
        UNIQUE(book_id, chapter_id)
      );
      CREATE INDEX IF NOT EXISTS chapter_summaries_book_status ON chapter_summaries(book_id, status, chapter_number);
      CREATE TABLE IF NOT EXISTS ai_analysis_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO ai_analysis_settings(setting_key, setting_value) VALUES ('concurrency', '2');
    `)
    // Databases created by an earlier build may not yet contain this ordering field.
    const summaryColumns = this.database.prepare('PRAGMA table_info(chapter_summaries)').all() as Array<{ name: string }>
    if (!summaryColumns.some((column) => column.name === 'chapter_position')) {
      this.database.exec('ALTER TABLE chapter_summaries ADD COLUMN chapter_position INTEGER NOT NULL DEFAULT 0')
    }
  }

  getSettings(): AiAnalysisSettings {
    const row = this.database.prepare("SELECT setting_value FROM ai_analysis_settings WHERE setting_key = 'concurrency'").get() as { setting_value?: string } | undefined
    const concurrency = Number(row?.setting_value ?? 2)
    return { concurrency: Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 10 ? concurrency : 2 }
  }

  saveSettings(settings: AiAnalysisSettings): void {
    this.database.prepare("INSERT INTO ai_analysis_settings(setting_key, setting_value) VALUES ('concurrency', ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value").run(String(settings.concurrency))
  }

  recoverInterruptedJobs():void{
    this.database.exec("BEGIN IMMEDIATE; UPDATE ai_analysis_job_chapters SET status='pending',error=NULL WHERE status='running'; UPDATE ai_analysis_jobs SET status='queued',current_chapter_id=NULL,updated_at=datetime('now') WHERE status='running'; COMMIT;")
  }

  close(): void {
    this.database.close()
  }
}
