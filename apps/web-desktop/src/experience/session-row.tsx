import type { ComponentProps, MouseEvent } from 'react'
import { browserClassNames as cn } from './ui/classnames'
import type { BrowserSessionRowModel } from './contracts/session-row'

/** Browser gestures never create desktop tabs or windows. Commands retain their row owner. */
export function activateBrowserSessionRow(event: MouseEvent, row: Pick<BrowserSessionRowModel, 'activate' | 'togglePin' | 'archive'>) {
  if (event.shiftKey || event.metaKey || event.ctrlKey) { event.preventDefault(); event.stopPropagation() }
  if (event.shiftKey && event.altKey) row.archive()
  else if (event.shiftKey && !event.metaKey && !event.ctrlKey) row.togglePin()
  else row.activate()
}

/** Athena owns row geometry and interactions; engine adapters supply values and commands. */
export function BrowserSessionRow({ row, className, ...props }: ComponentProps<'div'> & { row: BrowserSessionRowModel }) {
  const lead = <span {...(row.reorderable ? row.dragHandleProps : {})}
    className={cn('grid size-3.5 shrink-0 place-items-center overflow-hidden', row.reorderable && 'group/handle relative cursor-grab touch-none active:cursor-grabbing')}
    aria-label={row.reorderable ? `Reorder ${row.title}` : undefined}
    data-reorder-handle={row.reorderable ? '' : undefined}
    onClick={row.reorderable ? event => event.stopPropagation() : undefined}>
    <span className={cn('grid size-full place-items-center', row.reorderable && 'transition-opacity group-hover/handle:opacity-0 group-focus-within/handle:opacity-0')}>{row.status}</span>
    {row.reorderable && <i aria-hidden="true" style={{ fontSize: '0.75rem' }} className={cn('codicon codicon-grabber absolute text-(--ui-text-quaternary) opacity-0 transition-opacity group-hover/handle:opacity-80 group-focus-within/handle:opacity-80', row.dragging && 'opacity-100')} />}
  </span>
  const actions = <div className="relative z-2 flex shrink-0 items-center justify-end gap-1" data-row-actions
    onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
    {row.figures}{row.actions}
  </div>
  const title = <button type="button" data-slot="row-button" className="block w-full text-left">
    <span className={cn('browser-session-title block min-w-0 truncate text-[0.8125rem] leading-[1.35]',
      row.card ? 'font-medium text-(--ui-text-primary)' : 'font-normal text-(--ui-text-secondary)',
      'group-hover:text-foreground group-data-[working=true]:text-foreground/90')}><span>{row.title}</span></span>
  </button>
  return <div {...props} data-web-session-id={row.id} data-web-session-profile={row.profile}
    data-web-session-reorderable={row.reorderable ? '' : undefined}
    data-web-session-selected={row.selected || undefined} data-working={row.working ? 'true' : undefined}
    data-glass-opaque={row.dragging ? '' : undefined}
    className={cn('group row-hover relative grid min-h-[1.625rem] grid-cols-[minmax(0,1fr)_auto] items-stretch rounded-md pr-2',
      row.card && 'min-h-[3.375rem]', !row.card && row.density !== 'compact' && 'min-h-[2.75rem]',
      !row.card && row.density === 'detailed' && 'min-h-[3.875rem]', row.selected && 'bg-(--ui-row-active-background)',
      row.openElsewhere && 'bg-(--ui-row-open-background)', row.working && 'text-foreground',
      row.dragging && 'z-10 cursor-grabbing bg-(--ui-sidebar-surface-background)', className)}>
    {row.running && <span aria-hidden="true" className="arc-border arc-row" />}
    <div className={cn('z-0 flex h-full w-full min-w-0 cursor-pointer items-center self-stretch gap-1.5 py-0.5 pl-2 pr-2',
      row.branch && 'pl-3.5', row.card && 'flex-col items-stretch justify-center gap-[0.4rem] py-1.5 pr-0')}
      onClick={event => {
        // React portals retain their logical parent. Dialogs and menu items must
        // never inherit the row's primary action even when they portal to body.
        if (!event.currentTarget.contains(event.target as Node)) return
        activateBrowserSessionRow(event, row)
      }} onAuxClick={event => {
        if (event.button !== 1 || !event.currentTarget.contains(event.target as Node)) return
        event.preventDefault(); row.activate()
      }}>
      {row.card ? <>
        <div className="flex min-w-0 items-center gap-1.5">{lead}{row.leading}
          <span className="min-w-0 flex-1 truncate text-[0.6875rem] leading-[1.35] text-(--ui-text-tertiary)">{row.context}</span>
          {row.origin}{row.trailing}{actions}
        </div>
        <div className="flex min-w-0 flex-col gap-[0.15rem]">{title}
          {row.cardPreview && <span className="min-w-0 truncate text-[0.625rem] leading-[1.35] text-(--ui-text-quaternary)">{row.cardPreview}</span>}
        </div>
        {(row.model || row.size || row.progress) && <span className="flex min-w-0 items-baseline gap-2 text-[0.625rem] leading-[1.35] text-(--ui-text-tertiary)">
          {row.model && <span className="min-w-0 truncate">{row.model}</span>}{row.size && <span className="shrink-0 tabular-nums">{row.size}</span>}
          {row.progress && <span className="ml-auto shrink-0 tabular-nums" title={row.progressLabel}>{row.progress}</span>}
        </span>}
      </> : <>{lead}{row.leading}{row.origin}<span className="min-w-0 flex-1 self-center">{title}
        {row.density !== 'compact' && row.metadata && <span className="mt-0.5 block truncate text-[0.625rem] leading-[1.35] text-(--ui-text-tertiary)">{row.metadata}</span>}
        {row.density === 'detailed' && row.preview && <span className="mt-1 block truncate text-[0.625rem] leading-[1.35] text-(--ui-text-quaternary)">{row.preview}</span>}
      </span>{row.trailing}</>}
    </div>
    {!row.card && <div className="flex shrink-0 items-center self-stretch" data-row-actions>{actions}</div>}
  </div>
}
