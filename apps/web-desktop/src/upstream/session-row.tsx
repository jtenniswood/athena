import { compactNumber } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import { memo, type ComponentProps, type HTMLAttributes, type ReactNode } from 'react'
import { PrTag } from '@/app/chat/pr-tag'
import { ProfileTag } from '@/app/chat/profile-tag'
import { PlatformAvatar } from '@/app/messaging/platform-icon'
import { SessionActionsMenu, SessionContextMenu } from '@/app/chat/sidebar/session-actions-menu'
import { sessionRowDetails } from '@/app/chat/sidebar/session-row-details'
import { SessionRowSlot } from '@/app/chat/sidebar/session-row-slots'
import { useProfilePrewarm } from '@/app/chat/sidebar/use-profile-prewarm'
import { formatMessageTimestamp } from '@/components/assistant-ui/thread/timestamp'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Tip } from '@/components/ui/tooltip'
import type { SessionInfo } from '@/hermes'
import { useI18n } from '@/i18n'
import { sessionTitle } from '@/lib/chat-runtime'
import { pathLeaf } from '@/lib/display-path'
import { displayModelName } from '@/lib/model-status-label'
import { sessionProjectLabel } from '@/lib/session-project-label'
import { SESSION_ROW_AREAS } from '@/lib/session-row-slots'
import { handoffOriginSource, sessionSourceLabel } from '@/lib/session-source'
import { coarseElapsed } from '@/lib/time'
import { useStoreSelector } from '@/lib/use-session-slice'
import { $sidebarRowMeta } from '@/store/layout'
import { normalizeProfileKey } from '@/store/profile'
import { $projects } from '@/store/projects'
import { $pullRequestsByBranch, sessionPrKey } from '@/store/pull-requests'
import { sessionPinId } from '@/store/session'
import { $sessionDotStateById, hasLiveTurn, showsRunningArc } from '@/store/session-dot-state'
import { $sessionListDensity } from '@/store/session-list-density'
import { $openStoredSessionIds } from '@/store/session-states'
import { sessionCostUsd } from '@/store/sidebar-archive'
import { $todoProgressBySession } from '@/store/todos'
import { BrowserSessionRow } from '../experience/session-row'
import type { BrowserSessionRowModel } from '../experience/contracts/session-row'
import { BrowserSessionPreview } from '../experience/session-preview'
import { browserClassNames as cn } from '../experience/ui/classnames'

interface SidebarSessionRowProps extends ComponentProps<'div'> {
  session: SessionInfo
  branchStem?: string
  isPinned: boolean
  isSelected: boolean
  unread: boolean
  onArchive(): void
  onBranch?(): void
  onDelete(): void
  onPin(): void
  onToggleUnread(): void
  onResume(): void
  reorderable?: boolean
  dragging?: boolean
  dragHandleProps?: HTMLAttributes<HTMLElement>
  showProfile?: boolean
  card?: boolean
}

/** Project live engine metadata; mutation callbacks remain captured by the caller. */
function SidebarSessionRowAdapter({ session, branchStem, isPinned, isSelected, unread, onArchive, onBranch, onDelete, onPin,
  onToggleUnread, onResume, reorderable = false, dragging = false, dragHandleProps, showProfile = false, card = false, ...props }: SidebarSessionRowProps) {
  const { t } = useI18n(), r = t.sidebar.row
  const title = sessionTitle(session)
  const { cancelPrewarm, notePointerMove, startPrewarm } = useProfilePrewarm(session.profile)
  const density = useStore($sessionListDensity), rowMeta = useStore($sidebarRowMeta)
  const details = sessionRowDetails(session, { messageCount: t.sidebar.messageCount, toolCallCount: t.sidebar.toolCallCount })
  const timestamp = session.last_active || session.started_at, date = new Date(timestamp * 1000)
  const elapsed = coarseElapsed(Date.now() - timestamp * 1000)
  const ageKey = { day: 'ageDay', hour: 'ageHour', minute: 'ageMin' } as const
  const age = elapsed.unit === 'second' ? r.ageNow : `${elapsed.value}${r[ageKey[elapsed.unit]]}`
  const absolute = formatMessageTimestamp(date, t.assistant.thread)
  const prKey = sessionPrKey(session)
  const pr = useStoreSelector($pullRequestsByBranch, values => rowMeta.includes('pr') && prKey ? values[prKey] : undefined)
  const openElsewhere = useStoreSelector($openStoredSessionIds, open => !isSelected && open.has(session.id))
  const dotState = useStoreSelector($sessionDotStateById, states => states[session.id] ?? 'idle')
  const context = useStoreSelector($projects, projects => card ? sessionProjectLabel(session, projects) ?? (pathLeaf(session.cwd) || t.sidebar.projects.home) : null)
  const progress = useStoreSelector($todoProgressBySession, values => card ? values[session.id] : undefined)
  const tokens = session.input_tokens + session.output_tokens, cost = sessionCostUsd(session)
  const figures = [rowMeta.includes('tokens') && tokens > 0 ? compactNumber(tokens) : null,
    rowMeta.includes('cost') && cost >= 0.01 ? `$${cost.toFixed(2)}` : null].filter(Boolean) as string[]
  const working = hasLiveTurn(dotState)
  const showAge = rowMeta.includes('updated') || card
  const showUnread = dotState === 'unread'
  const showTail = working || showAge || showUnread
  const separator = card ? '\u00a0\u00a0' : ' · '
  const head = (showTail ? figures : figures.slice(0, -1)).join(separator)
  const trailing: ReactNode[] = []
  if ((showProfile || rowMeta.includes('profile')) && normalizeProfileKey(session.profile) !== 'default') trailing.push(<ProfileTag key="profile" profile={session.profile} />)
  if (pr) trailing.push(<PrTag key="pr" pr={pr} />)
  if (figures.length || showTail) trailing.push(<span key="figures" className="pointer-events-none whitespace-nowrap text-[0.625rem] leading-none text-(--ui-text-tertiary)">
    {showTail && head ? <span className="min-w-0 truncate">{head}{separator}</span> : head}
    <span className={cn('session-row-tail inline-block min-w-5 text-right', !working && 'transition-opacity group-hover:opacity-0')}>{!showTail && head && separator}
      {working ? <span className="browser-session-spinner" role="status" aria-label={r.sessionRunning} />
        : showUnread ? <span data-session-unread="" role="status" aria-label={r.finishedUnread} title={r.finishedUnread}
        className="inline-flex size-2.5 items-center justify-center align-middle"><span className="size-1.5 rounded-full bg-(--ui-blue)" /></span>
        : showAge ? <Tip label={absolute} side="top"><time aria-label={`${age}, ${absolute}`} dateTime={date.toISOString()} tabIndex={0}
        className="pointer-events-auto focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring">{age}</time></Tip> : figures.at(-1)}
    </span></span>)
  const menu = { archived: Boolean(session.archived), onArchive, onBranch, onDelete, onPin, onToggleUnread,
    pinned: isPinned, profile: session.profile, sessionId: session.id, title, unread }
  const handoff = handoffOriginSource(session.handoff_state, session.handoff_platform)
  const originLabel = handoff ? sessionSourceLabel(handoff) ?? handoff : null
  const row: BrowserSessionRowModel = {
    id: session.id, profile: session.profile || 'default', title, selected: isSelected, working,
    running: showsRunningArc(dotState), openElsewhere, dragging, reorderable, branch: Boolean(branchStem), card, density,
    context, metadata: details.metadata, preview: details.preview, cardPreview: rowMeta.includes('preview') ? session.preview : null,
    model: card && session.model ? displayModelName(session.model) : '', size: card && session.message_count > 0 ? r.messageCount(session.message_count) : '',
    progress, progressLabel: r.todoProgress, dragHandleProps,
    status: session.archived ? <Codicon name="archive" size="0.75rem" className="text-(--ui-text-quaternary)" />
      : branchStem ? <span aria-hidden="true" className="font-mono text-[0.625rem] leading-none text-(--ui-text-quaternary)">{branchStem}</span> : null,
    origin: handoff && originLabel ? <Tip label={r.handoffOrigin(originLabel)}><PlatformAvatar className="-mt-px size-4 shrink-0 rounded-[4px] text-[0.5rem] [&_svg]:size-2.5" platformId={handoff} platformName={originLabel} /></Tip> : null,
    leading: <SessionRowSlot area={SESSION_ROW_AREAS.leading} sessionId={sessionPinId(session)} />,
    trailing: <SessionRowSlot area={SESSION_ROW_AREAS.trailing} sessionId={sessionPinId(session)} />,
    figures: trailing.map((node, index) => <span key={index} className={cn(
      showTail && index === trailing.length - 1 && 'browser-session-status-figures',
      !figures.length && !showTail && index === trailing.length - 1 && 'session-row-tail inline-flex min-w-5 justify-end transition-opacity group-hover:opacity-0'
    )}>{node}</span>),
    actions: <span data-browser-session-actions=""><SessionActionsMenu {...menu}><Button aria-label={r.sessionActions} size="icon" variant="ghost"
      className="size-5 rounded-[4px] bg-transparent text-transparent transition-colors duration-100 hover:bg-(--ui-control-active-background) hover:text-foreground focus-visible:bg-(--ui-control-active-background) focus-visible:text-foreground focus-visible:ring-0 data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground group-hover:text-(--ui-text-tertiary) [&_svg]:size-3.5!">
      <Codicon name="ellipsis" size="0.875rem" /></Button></SessionActionsMenu>
      {!session.archived && <Tip label={r.archive} placement="toolbar"><Button type="button" className="browser-session-archive" aria-label={r.archive} size="icon" variant="ghost" onClick={onArchive}>
        <Codicon name="archive" size="0.875rem" />
      </Button></Tip>}
    </span>,
    activate: onResume, togglePin: onPin, archive: onArchive
  }
  return <SessionContextMenu {...menu}><BrowserSessionPreview session={session} title={title} disabled={dragging}>
    <BrowserSessionRow row={row} onPointerEnter={startPrewarm} onPointerLeave={cancelPrewarm} onPointerMove={notePointerMove}
      onPointerDown={event => {
        if (!event.currentTarget.contains(event.target as Node) || event.button !== 0 ||
          (event.target as Element).closest('[data-reorder-handle], [data-row-actions]')) return
        // The browser shell owns project drops. Only the sortable listener owns
        // row reordering; desktop pane dragging is never started here.
        dragHandleProps?.onPointerDown?.(event)
      }} {...props} />
  </BrowserSessionPreview></SessionContextMenu>
}

// Engine updates can refresh siblings while a row's own subscriptions remain
// quiet. Callbacks capture this same session owner and do not change its data.
export const SidebarSessionRow = memo(SidebarSessionRowAdapter, (a, b) =>
  a.session === b.session && a.isPinned === b.isPinned && a.isSelected === b.isSelected && a.unread === b.unread &&
  a.branchStem === b.branchStem && a.reorderable === b.reorderable && a.dragging === b.dragging && a.showProfile === b.showProfile &&
  a.card === b.card && a.dragHandleProps === b.dragHandleProps && a.className === b.className && a.style === b.style)
