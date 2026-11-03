import type { ReactNode } from 'react'
import { browserClassNames as cn } from './ui/classnames'
import { useBrowserSidebarSection } from './sidebar-sections'

export interface BrowserSidebarSectionModel {
  id: string
  label: string
  open: boolean
  collapsible: boolean
  toggle(): void
  icon?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  className?: string
  contentClassName?: string
  pinned: boolean
}

/** Stable identity and disclosure belong to the browser; list state stays in Hermes. */
export function BrowserSidebarSection({ model, children, footer }: { model: BrowserSidebarSectionModel; children: ReactNode; footer?: ReactNode }) {
  const identity = useBrowserSidebarSection(model.id, model.label)
  const label = <>{model.icon}<span className="flex min-w-0 items-center gap-2 pl-2 text-[0.64rem] font-semibold uppercase tracking-[0.16em] text-(--theme-primary)">
    <span aria-hidden="true" className="dither inline-block size-2 shrink-0 rounded-[1px]" />
    <span className="min-w-0 truncate leading-none">{model.label}</span>
  </span>{model.meta && <span className="shrink-0 text-[0.6875rem] font-medium text-(--ui-text-quaternary)">{model.meta}</span>}</>
  return <div {...identity} data-sidebar="group" data-slot="sidebar-group" data-session-pin-drop={model.pinned ? '' : undefined}
    data-session-unpin-drop={!model.pinned ? '' : undefined}
    className={cn('relative flex w-full min-w-0 flex-col rounded-[6px] p-2 data-[session-drop-hover=true]:outline-2 data-[session-drop-hover=true]:-outline-offset-2 data-[session-drop-hover=true]:outline-sidebar-ring', model.className)}>
    <div data-browser-section-header="" className="group/section flex shrink-0 items-center justify-between gap-1 pb-1 pt-1.5">
      {model.collapsible ? <button type="button" data-browser-section-label="" aria-expanded={model.open} onClick={model.toggle}
        className="group/section-label flex w-fit min-w-0 items-center gap-1 bg-transparent text-left leading-none">
        {label}<i aria-hidden="true" style={{ fontSize: '0.75rem' }} className={cn('codicon codicon-chevron-right shrink-0 text-(--ui-text-tertiary) opacity-0 transition-transform duration-150 group-hover/section-label:opacity-100', model.open && 'rotate-90')} />
      </button> : <div data-browser-section-label="" className="flex w-fit min-w-0 items-center gap-1 leading-none">{label}</div>}
      {model.actions}
    </div>
    {model.open && <div data-sidebar="group-content" data-slot="sidebar-group-content" className={cn('w-full text-sm', model.contentClassName)}>{children}{footer}</div>}
  </div>
}
