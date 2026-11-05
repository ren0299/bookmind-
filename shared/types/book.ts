export interface Book {
  id: string
  name: string
  path: string
  type?: 'pdf' | 'txt'
  author?: string
  novelTaskId?: string
}
