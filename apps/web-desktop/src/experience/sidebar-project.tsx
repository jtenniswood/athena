import type { ComponentProps, HTMLAttributes, ReactNode, RefObject } from 'react'
import { browserClassNames as cn } from './ui/classnames'
import { BrowserTreeAdd, BrowserTreeHeader, BrowserTreeMore, BrowserTreeStack } from './sidebar-tree'

export interface BrowserSidebarProjectModel {
  id: string
  label: string
  icon: string
  color?: string | null
  active: boolean
  open: boolean
  hasRows: boolean
  dragging: boolean
  reorderable: boolean
  reorderLabel: string
  toggleLabel: string
  autoLabel?: string
  anchor: RefObject<HTMLDivElement | null>
  dragHandleProps?: HTMLAttributes<HTMLElement>
  toggle(): void
  enter(): void
  menu: ReactNode
  wrapHeader?(header: ReactNode): ReactNode
  figures: string
  create?: { label: string; run(): void; pointerDown?: ComponentProps<'button'>['onPointerDown'] }
  more: { label: string; disabled?: boolean; run(): void }[]
}

/** Browser tree geometry and disclosure, driven by the existing project owner. */
export function BrowserSidebarProject({ model, children, ...props }: ComponentProps<'div'> & { model: BrowserSidebarProjectModel }) {
  const icon = <i aria-hidden="true" className={`codicon codicon-${model.icon} text-(--ui-text-tertiary)`} style={{ fontSize: '0.75rem', color: model.color || undefined }} />
  const lead = model.reorderable ? <span {...model.dragHandleProps} aria-label={model.reorderLabel} data-reorder-handle=""
    className="group/handle relative grid size-3.5 shrink-0 cursor-grab touch-none place-items-center overflow-visible"
    onClick={event => { event.stopPropagation(); model.toggle() }}>
    <span className="grid size-full place-items-center transition-opacity group-hover/handle:opacity-0 group-focus-within/handle:opacity-0">{icon}</span>
    <i aria-hidden="true" className={cn('codicon codicon-grabber absolute text-(--ui-text-quaternary) opacity-0 group-hover/handle:opacity-80 group-focus-within/handle:opacity-80', model.dragging && 'opacity-100')} style={{ fontSize: '0.75rem' }} />
  </span> : icon
  const controls = <>{model.create && <BrowserTreeAdd label={model.create.label} onClick={model.create.run} onPointerDown={model.create.pointerDown} />}{model.menu}</>
  const header = <BrowserTreeHeader ref={model.anchor}
    className={cn('rounded-md', model.dragging && 'cursor-grabbing bg-(--ui-sidebar-surface-background)')}
    data-glass-opaque={model.dragging ? '' : undefined} onPointerDown={event => {
      if (!event.currentTarget.contains(event.target as Node) || (event.target as Element).closest('[data-reorder-handle], [data-row-actions]')) return
      model.dragHandleProps?.onPointerDown?.(event)
    }} model={{ label: model.label, title: model.autoLabel, open: model.open, toggle: model.toggle, enter: model.enter,
      toggleLabel: model.toggleLabel, active: model.active, project: true, icon: lead,
      actions: <div data-row-actions="" className="flex shrink-0 items-center self-stretch">
        {model.figures ? <div className="relative flex items-center"><span className="min-w-9 whitespace-nowrap text-right text-[0.625rem] leading-none text-(--ui-text-tertiary) transition-opacity group-hover/workspace:opacity-0">{model.figures}</span><div className="absolute right-0 flex items-center">{controls}</div></div> : controls}
      </div> }} />
  return <BrowserTreeStack {...props} data-sessions-project={model.id} className={cn('rounded-[6px] data-[session-drop-hover=true]:outline-2 data-[session-drop-hover=true]:-outline-offset-2 data-[session-drop-hover=true]:outline-sidebar-ring', model.dragging && 'relative z-10')}>
    {model.wrapHeader ? model.wrapHeader(header) : header}
    {model.open && model.hasRows && <>{children}
      {model.more.map(action => <BrowserTreeMore key={action.label} label={action.label} disabled={action.disabled} onClick={action.run} />)}
    </>}
  </BrowserTreeStack>
}
