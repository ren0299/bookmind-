import type { NovelMetadata } from '../../../../shared/types/novel.ts'

export interface NovelAdapter {
  readonly id: string
  matches(url: URL): boolean
  parse(url: URL): Promise<NovelMetadata>
  fetchChapter(url: string): Promise<string>
}
