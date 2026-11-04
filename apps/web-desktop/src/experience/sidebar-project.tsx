import type { ComponentProps, HTMLAttributes, ReactNode, RefObject } from 'react'
import { browserClassNames as cn } from './ui/classnames'
import { preserveNavigationForNextSelection } from './conversation-navigation'

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
}

/** Browser tree geometry and disclosure, driven by the existing project owner. */
export function BrowserSidebarProject({ model, children, ...props }: ComponentProps<'div'> & { model: BrowserSidebarProjectModel }) {
  const icon = <i aria-hidden="true" className={`codicon codicon-${model.icon}`} style={{ fontSize: '0.875rem', color: model.color || undefined }} />
  const controls = <>{model.menu}{model.create && <button type="button" aria-label={model.create.label} title={model.create.label}
    onClick={event => { event.stopPropagation(); preserveNavigationForNextSelection(); model.create?.run() }} onPointerDown={model.create.pointerDown}
    className="grid size-4 shrink-0 place-items-center rounded-sm bg-transparent text-(--ui-text-quaternary) opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) hover:text-foreground group-hover/workspace:opacity-100 focus-visible:opacity-100">
    <i aria-hidden="true" className="codicon codicon-add" style={{ fontSize: '0.75rem' }} />
  </button>}</>
  const header = <div ref={model.anchor} className={cn('group/workspace grid min-h-[1.625rem] grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md pr-2',
    model.dragging && 'cursor-grabbing bg-(--ui-sidebar-surface-background)')} data-glass-opaque={model.dragging ? '' : undefined}
    onPointerDown={event => {
      if (!event.currentTarget.contains(event.target as Node) || (event.target as Element).closest('[data-reorder-handle], [data-row-actions]')) return
      model.dragHandleProps?.onPointerDown?.(event)
    }}>
    <div className="flex h-full min-w-0 flex-1 items-center self-stretch gap-1.5 py-0.5 pl-2 pr-2">
      {model.reorderable ? <span {...model.dragHandleProps} aria-label={model.reorderLabel} data-reorder-handle=""
        className="group/handle relative grid size-3.5 shrink-0 cursor-grab touch-none place-items-center overflow-visible"
        onClick={event => { event.stopPropagation(); model.toggle() }}>
        <span className="grid size-full place-items-center transition-opacity group-hover/handle:opacity-0 group-focus-within/handle:opacity-0">{icon}</span>
        <i aria-hidden="true" className={cn('codicon codicon-grabber absolute text-(--ui-text-quaternary) opacity-0 group-hover/handle:opacity-80 group-focus-within/handle:opacity-80', model.dragging && 'opacity-100')} style={{ fontSize: '0.75rem' }} />
      </span> : <button type="button" aria-label={model.toggleLabel} onClick={model.toggle} className="grid size-3.5 shrink-0 place-items-center bg-transparent">{icon}</button>}
      <button type="button" data-slot="row-button" aria-label={model.toggleLabel} title={model.autoLabel}
        onClick={model.toggle} onDoubleClick={model.enter} className="min-w-0 shrink bg-transparent p-0 text-left">
        <span className={cn('min-w-0 truncate text-[0.8125rem] leading-[1.35] text-(--ui-text-secondary) hover:text-foreground hover:underline', model.active && 'text-foreground')}>{model.label}</span>
      </button>
      {model.hasRows ? <button type="button" aria-label={model.toggleLabel} onClick={model.toggle} data-row-actions=""
        className="flex flex-1 items-center self-stretch bg-transparent p-0">
        <i aria-hidden="true" className={cn('codicon codicon-chevron-right shrink-0 text-(--ui-text-tertiary) opacity-0 transition-transform duration-150 group-hover/workspace:opacity-100', model.open && 'rotate-90')} style={{ fontSize: '0.75rem' }} />
      </button> : <span className="flex-1" />}
    </div>
    <div data-row-actions="" className="flex shrink-0 items-center self-stretch">
      {model.figures ? <div className="relative flex items-center"><span className="min-w-9 whitespace-nowrap text-right text-[0.625rem] leading-none text-(--ui-text-tertiary) transition-opacity group-hover/workspace:opacity-0">{model.figures}</span><div className="absolute right-0 flex items-center">{controls}</div></div> : controls}
    </div>
  </div>
  return <div {...props} data-sessions-project={model.id} className={cn('rounded-[6px] data-[session-drop-hover=true]:outline-2 data-[session-drop-hover=true]:-outline-offset-2 data-[session-drop-hover=true]:outline-sidebar-ring', model.dragging && 'relative z-10')}>
    {model.wrapHeader ? model.wrapHeader(header) : header}
    {model.open && model.hasRows && <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-px pb-1 pl-2">{children}</div>}
  </div>
}
