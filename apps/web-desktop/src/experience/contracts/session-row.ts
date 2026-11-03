import type { HTMLAttributes, ReactNode } from 'react'

/** One rendered row, projected from the engine without copying its session store. */
export interface BrowserSessionRowModel {
  id: string
  profile: string
  title: string
  selected: boolean
  working: boolean
  running: boolean
  openElsewhere: boolean
  dragging: boolean
  reorderable: boolean
  branch: boolean
  card: boolean
  density: 'compact' | 'comfortable' | 'detailed'
  context: string | null
  metadata: string
  preview: string | null
  cardPreview: string | null
  model: string
  size: string
  progress: string | undefined
  progressLabel: string
  dragHandleProps?: HTMLAttributes<HTMLElement>
  status: ReactNode
  origin: ReactNode
  leading: ReactNode
  trailing: ReactNode
  figures: ReactNode
  actions: ReactNode
  activate(): void
  togglePin(): void
  archive(): void
}
