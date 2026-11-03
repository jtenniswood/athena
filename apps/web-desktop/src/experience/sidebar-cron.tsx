import type { ReactNode } from 'react'
import { browserClassNames as cn } from './ui/classnames'

export interface BrowserCronRowModel {
  label: string
  meta: string
  stateClass: string
  running: boolean
  busy: boolean
  expanded: boolean
  toggleLabel: string
  triggerLabel: string
  manageLabel: string
  toggle(): void
  trigger(): void
  manage(): void
  wrap(header: ReactNode): ReactNode
}

/** Scheduled jobs share browser row geometry without taking over the cron engine. */
export function BrowserCronRow({ model, children }: { model: BrowserCronRowModel; children: ReactNode }) {
  const header = <div className="group/cron relative grid min-h-[1.625rem] grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md pr-2 hover:bg-(--chrome-action-hover)">
    <button type="button" data-slot="row-button" title={model.label} aria-expanded={model.expanded} aria-label={model.toggleLabel} onClick={model.toggle}
      className="flex h-full min-w-0 items-center self-stretch gap-1.5 bg-transparent py-0.5 pl-2 pr-2 text-left focus-visible:bg-(--chrome-action-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
      <span className="grid size-3.5 shrink-0 place-items-center"><span aria-hidden="true" className={cn('size-1 rounded-full', model.stateClass, model.running && 'size-1.5 animate-pulse')} /></span>
      <span className="min-w-0 truncate text-[0.8125rem] leading-[1.35] text-(--ui-text-secondary) group-hover/cron:text-foreground">{model.label}</span>
      <i aria-hidden="true" className={cn('codicon codicon-chevron-right shrink-0 text-(--ui-text-tertiary) transition', model.expanded ? 'rotate-90 opacity-100' : 'opacity-0 group-hover/cron:opacity-100')} style={{ fontSize: '0.75rem' }} />
    </button>
    <div data-row-actions="" className="flex shrink-0 items-center self-stretch gap-0.5">
      <span className="text-[0.6875rem] text-(--ui-text-tertiary) tabular-nums group-hover/cron:hidden group-focus-within/cron:hidden">{model.meta}</span>
      <div className="hidden items-center gap-0.5 group-hover/cron:flex group-focus-within/cron:flex">
        <button type="button" title={model.triggerLabel} aria-label={model.triggerLabel} disabled={model.busy} onClick={model.trigger}
          className="grid size-5 place-items-center rounded-sm text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:cursor-wait disabled:opacity-60">
          <i aria-hidden="true" className={cn('codicon', model.busy ? 'codicon-loading animate-spin' : 'codicon-zap')} style={{ fontSize: '0.75rem' }} />
        </button>
        <button type="button" title={model.manageLabel} aria-label={model.manageLabel} onClick={model.manage}
          className="grid size-5 place-items-center rounded-sm text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground">
          <i aria-hidden="true" className="codicon codicon-watch" style={{ fontSize: '0.75rem' }} />
        </button>
      </div>
    </div>
  </div>
  return <div>{model.wrap(header)}{model.expanded && children}</div>
}

export interface BrowserCronRunModel { id: string; label: string; selected: boolean; open?: () => void }

export function BrowserCronRuns({ rows, loadingLabel, emptyLabel }: { rows: BrowserCronRunModel[] | null; loadingLabel: string; emptyLabel: string }) {
  const base = 'truncate rounded-md px-1.5 py-0.5 text-[0.6875rem] tabular-nums'
  return <div className="mb-1 ml-[1.375rem] flex flex-col gap-px">
    {rows === null ? <div className="flex items-center gap-1.5 py-1 pl-1 text-[0.6875rem] text-(--ui-text-tertiary)"><i role="status" aria-label={loadingLabel} className="codicon codicon-loading animate-spin text-[0.75rem]" /></div> :
      rows.length === 0 ? <div className="py-1 pl-1 text-[0.6875rem] text-(--ui-text-tertiary)">{emptyLabel}</div> :
      rows.map(row => row.open ? <button type="button" key={row.id} onClick={row.open}
        className={cn(base, 'text-left focus-visible:bg-(--chrome-action-hover) focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40', row.selected ? 'bg-(--ui-row-active-background) text-foreground' : 'text-(--ui-text-secondary) hover:bg-(--chrome-action-hover) hover:text-foreground')}>
        {row.label}
      </button> : <div className={cn(base, 'text-(--ui-text-secondary)')} key={row.id}>{row.label}</div>)}
  </div>
}
