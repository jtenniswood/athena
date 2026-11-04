import type { ComponentProps, HTMLAttributes, ReactNode, RefObject } from 'react'
import { useStore } from '@nanostores/react'
import { compactNumber } from '@hermes/shared'
import { startNewSessionDrag, type NewSessionSplitHandler } from '@/app/chat/new-session-drag'
import { ProjectContextMenu, ProjectMenu } from '@/app/chat/sidebar/projects/project-menu'
import type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'
import { useI18n } from '@/i18n'
import { $sidebarRowMeta } from '@/store/layout'
import { BrowserSidebarProject, type BrowserSidebarProjectModel } from '../experience/sidebar-project'

interface ProjectController {
  project: SidebarProjectTree
  isActive: boolean
  open: boolean
  toggleOpen(): void
  onEnter?(id: string): void
  onNewSession?(path: string | null): void
  onNewSessionSplit?: NewSessionSplitHandler
  newSessionPath: string | null
  rowRef: RefObject<HTMLDivElement | null>
  reorderable: boolean
  dragging: boolean
  dragHandleProps?: HTMLAttributes<HTMLElement>
  hasRows: boolean
  rows: ReactNode
  offerShowAll: boolean
  expanding: boolean
  showAll(): void
  total: number
  moreCount: number
  showMore(): void
}

/** Translate the live renderer project controller without owning any tree state. */
export function BrowserProjectControllerSurface({ model, ...props }: ComponentProps<'div'> & { model: ProjectController }) {
  const { t } = useI18n(), s = t.sidebar, meta = useStore($sidebarRowMeta)
  const { project } = model
  const tokens = project.totalTokens ?? 0, cost = project.totalCostUsd ?? 0
  const figures = [meta.includes('tokens') && tokens > 0 ? compactNumber(tokens) : null,
    meta.includes('cost') && cost >= 0.01 ? `$${cost.toFixed(2)}` : null].filter(Boolean).join(' · ')
  const row: BrowserSidebarProjectModel = {
    id: project.id, label: project.label, active: model.isActive, open: model.open, hasRows: model.hasRows,
    icon: project.isNoProject ? project.icon || 'home' : 'git-branch', color: project.color,
    dragging: model.dragging, reorderable: model.reorderable, dragHandleProps: model.dragHandleProps,
    reorderLabel: s.projects.reorder(project.label), toggleLabel: s.projects.toggle(project.label, !model.open),
    autoLabel: project.isAuto ? s.projects.autoDiscovered : undefined, anchor: model.rowRef,
    toggle: model.toggleOpen, enter: () => model.onEnter?.(project.id), figures,
    menu: project.isNoProject ? null : <ProjectMenu anchorRef={model.rowRef} isActive={model.isActive} project={project} />,
    wrapHeader: project.isNoProject ? undefined : header => <ProjectContextMenu isActive={model.isActive} project={project}>{header}</ProjectContextMenu>,
    create: model.onNewSession ? {
      label: s.newSessionIn(project.label), run: () => model.onNewSession?.(model.newSessionPath),
      pointerDown: model.onNewSessionSplit ? event => startNewSessionDrag(placement => {
        model.onNewSessionSplit?.(placement.dir, { anchor: placement.anchor, before: placement.before, cwd: model.newSessionPath })
      }, event, { cwd: model.newSessionPath, label: s.newSessionIn(project.label) }) : undefined
    } : undefined,
    more: [
      ...(model.offerShowAll ? [{ label: s.projects.showAllCount(model.total), disabled: model.expanding, run: model.showAll }] : []),
      ...(model.moreCount > 0 ? [{ label: s.showMoreIn(model.moreCount, project.label), run: model.showMore }] : [])
    ]
  }
  return <BrowserSidebarProject {...props} model={row}>{model.rows}</BrowserSidebarProject>
}
