import type { ComponentProps, HTMLAttributes, ReactNode } from 'react'
import { browserClassNames as cn } from './ui/classnames'
import { preserveNavigationForNextSelection } from './conversation-navigation'

export function BrowserTreeStack({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-px', className)} {...props} />
}

export function BrowserTreeAdd({ label, onClick, onPointerDown, icon = 'add', className }: {
  label: string; onClick(): void; onPointerDown?: ComponentProps<'button'>['onPointerDown']; icon?: string; className?: string
}) {
  return <button type="button" aria-label={label} title={label} onClick={() => { preserveNavigationForNextSelection(); onClick() }} onPointerDown={onPointerDown}
    className={cn('grid size-4 shrink-0 place-items-center rounded-sm bg-transparent text-(--ui-text-quaternary) opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) hover:text-foreground group-hover/workspace:opacity-100 focus-visible:opacity-100', className)}>
    <i aria-hidden="true" className={`codicon codicon-${icon}`} style={{ fontSize: '0.75rem' }} />
  </button>
}

export function BrowserTreeMore({ label, onClick, disabled, compact = false }: {
  label: string; onClick(): void; disabled?: boolean; compact?: boolean
}) {
  if (compact) return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}
    className="mr-2 ml-auto grid size-5 place-items-center rounded-sm bg-transparent text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground">
    <i aria-hidden="true" className="codicon codicon-ellipsis" style={{ fontSize: '0.75rem' }} />
  </button>
  return <div className="grid min-h-[1.625rem] grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md pr-2">
    <button type="button" data-slot="row-button" onClick={onClick} disabled={disabled}
      className="group/more flex h-full w-full min-w-0 items-center gap-1.5 bg-transparent py-0.5 pl-2 pr-2 text-left text-(--ui-text-tertiary) hover:text-foreground">
      <i aria-hidden="true" className="codicon codicon-ellipsis grid size-3.5 shrink-0 place-items-center" style={{ fontSize: '0.875rem' }} />
      <span className="min-w-0 truncate text-xs leading-[1.35] underline-offset-4 group-hover/more:underline">{label}</span>
    </button>
  </div>
}

export interface BrowserTreeHeaderModel {
  label: string
  title?: string
  open: boolean
  toggle(): void
  enter?(): void
  toggleLabel?: string
  active?: boolean
  emphasis?: boolean
  icon: ReactNode
  actions?: ReactNode
}

/** Keep the distinguishing tail of branch names visible in a narrow sidebar. */
export function BrowserTreeHeader({ model, className, ...props }: ComponentProps<'div'> & { model: BrowserTreeHeaderModel }) {
  const tailLength = Math.min(14, Math.floor(model.label.length / 2))
  return <div {...props} className={cn('group/workspace flex min-h-6 items-center gap-1 px-2 pt-1 text-[0.6875rem]',
    model.emphasis ? 'font-semibold text-(--ui-text-secondary)' : 'font-medium text-(--ui-text-tertiary)', className)}>
    <button type="button" aria-label={model.toggleLabel} aria-expanded={model.open} onClick={model.toggle} onDoubleClick={model.enter}
      className={cn('flex min-w-0 flex-1 items-center gap-1.5 bg-transparent text-left', model.emphasis ? 'hover:text-foreground' : 'hover:text-(--ui-text-secondary)')}>
      <span className="grid size-3.5 shrink-0 place-items-center">{model.icon}</span>
      <span className={cn('flex min-w-0 overflow-hidden', model.active && 'text-foreground')} title={model.title ? `${model.label}\n${model.title}` : model.label}>
        <span className="truncate">{model.label.slice(0, model.label.length - tailLength)}</span>
        <span className="shrink-0 whitespace-pre">{model.label.slice(model.label.length - tailLength)}</span>
      </span>
      <i aria-hidden="true" className={cn('codicon codicon-chevron-right shrink-0 text-(--ui-text-tertiary) opacity-0 transition group-hover/workspace:opacity-100', model.open && 'rotate-90')} style={{ fontSize: '0.75rem' }} />
    </button>{model.actions}
  </div>
}

export interface BrowserProfileHeaderModel {
  label: string
  labelClassName?: string
  labelAria?: string
  open: boolean
  toggleLabel: string
  toggle(): void
  activate(): void
  icon: ReactNode
  actions?: ReactNode
  figures: string
  reorder?: { label: string; dragging: boolean; bindings: HTMLAttributes<HTMLElement> }
}

export function BrowserProfileHeader({ model }: { model: BrowserProfileHeaderModel }) {
  const reorder = model.reorder
  return <div className={cn('group/workspace grid min-h-[1.625rem] grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md pr-2', reorder?.dragging && 'cursor-grabbing bg-(--ui-sidebar-surface-background)')}
    data-glass-opaque={reorder?.dragging ? '' : undefined} onPointerDown={event => {
      if (!event.currentTarget.contains(event.target as Node) || (event.target as Element).closest('[data-reorder-handle], [data-row-actions]')) return
      reorder?.bindings.onPointerDown?.(event)
    }}>
    <div className="flex h-full min-w-0 flex-1 items-center self-stretch gap-1.5 py-0.5 pl-2 pr-2">
      {reorder ? <span {...reorder.bindings} aria-label={reorder.label} data-reorder-handle="" onClick={event => event.stopPropagation()}
        className="group/handle relative grid size-3.5 shrink-0 cursor-grab touch-none place-items-center overflow-hidden active:cursor-grabbing">
        <span className="grid size-full place-items-center transition-opacity group-hover/handle:opacity-0 group-focus-within/handle:opacity-0">{model.icon}</span>
        <i aria-hidden="true" className={cn('codicon codicon-grabber absolute text-(--ui-text-quaternary) opacity-0 group-hover/handle:opacity-80 group-focus-within/handle:opacity-80', reorder.dragging && 'opacity-100')} style={{ fontSize: '0.75rem' }} />
      </span> : <span className="grid size-3.5 shrink-0 place-items-center">{model.icon}</span>}
      <button type="button" data-slot="row-button" aria-label={model.labelAria} aria-expanded={model.open} onClick={model.activate} className="min-w-0 shrink bg-transparent p-0 text-left">
        <span className={cn('min-w-0 truncate text-[0.8125rem] leading-[1.35] text-(--ui-text-secondary)', model.labelClassName)}>{model.label}</span>
      </button>
      <button type="button" aria-label={model.toggleLabel} aria-expanded={model.open} title={model.toggleLabel} onClick={model.toggle} data-row-actions="" className="flex flex-1 items-center self-stretch bg-transparent p-0">
        <i aria-hidden="true" className={cn('codicon codicon-chevron-right shrink-0 text-(--ui-text-tertiary) opacity-0 transition group-hover/workspace:opacity-100', model.open && 'rotate-90')} style={{ fontSize: '0.75rem' }} />
      </button>
    </div>
    <div data-row-actions="" className="flex shrink-0 items-center self-stretch">{model.figures ? <div className="relative flex items-center">
      <span className="min-w-9 whitespace-nowrap text-right text-[0.625rem] leading-none text-(--ui-text-tertiary) transition-opacity group-hover/workspace:opacity-0">{model.figures}</span>
      {model.actions && <div className="absolute right-0 flex items-center">{model.actions}</div>}
    </div> : model.actions}</div>
  </div>
}

export function BrowserTreeBody({ empty, emptyLabel, children, more }: { empty: boolean; emptyLabel: string; children: ReactNode; more?: ReactNode }) {
  return <>{empty ? <div className="min-h-7 pl-2 text-[0.75rem] leading-7 text-(--ui-text-quaternary)">{emptyLabel}</div> : children}{more}</>
}

export function BrowserRepository({ model, children, dialogs }: { model: BrowserTreeHeaderModel; children: ReactNode; dialogs: ReactNode }) {
  return <BrowserTreeStack><BrowserTreeHeader model={model} />{model.open && <BrowserTreeStack className="pl-2.5">{children}</BrowserTreeStack>}{dialogs}</BrowserTreeStack>
}
