import type { NovelTask } from '../types/novel.ts'

export function areAllNovelChaptersComplete(task: Pick<NovelTask, 'chapters'>): boolean {
  return task.chapters.length > 0 && task.chapters.every(chapter => chapter.status === 'completed')
}

export function isNovelTaskArchived(task: NovelTask): boolean {
  return task.status === 'completed' && areAllNovelChaptersComplete(task)
}

export function partitionNovelTasks(tasks: NovelTask[]): { active: NovelTask[]; completed: NovelTask[] } {
  return {
    active: tasks.filter(task => !isNovelTaskArchived(task)),
    completed: tasks.filter(isNovelTaskArchived),
  }
}
