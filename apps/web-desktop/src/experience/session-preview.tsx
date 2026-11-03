import { useEffect, useState, type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getSessionMessages, type SessionInfo } from '@/hermes'
import { chatMessageText, toChatMessages } from '@/lib/chat-messages'
import { displayModelName } from '@/lib/model-status-label'

// Mounted by the tooltip portal only after an intentional hover or keyboard focus.
// A passive, owner-scoped read never selects a chat or changes its read watermark.
function LatestGeneration({ session }: { session: SessionInfo }) {
  const [result, setResult] = useState<{ text: string; timestamp?: number } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let active = true
    setResult(null)
    setUnavailable(false)
    getSessionMessages(session.id, {
      profile: session.profile || 'default',
      connectionId: session.connection_id || undefined
    }, { limit: 60, order: 'latest', includeCompacted: true }, { passive: true }).then(page => {
      if (!active) return
      // Older servers can ignore latest ordering; never label an old reply as the latest.
      if (page.pagination?.order !== 'latest' && (session.message_count > page.messages.length || page.messages.length >= 60)) {
        setUnavailable(true)
        return
      }
      const message = toChatMessages(page.messages).findLast(message =>
        message.role === 'assistant' && !message.hidden && !message.interim && chatMessageText(message).trim()
      )
      if (message) setResult({ text: chatMessageText(message), timestamp: message.timestamp })
      else setUnavailable(true)
    }).catch(() => { if (active) setUnavailable(true) })
    return () => { active = false }
  }, [session.id, session.profile, session.connection_id, session.last_active, session.message_count])

  return <div className="browser-session-generation">
    <div className="browser-session-preview-caption">Latest reply</div>
    {result?.timestamp ? <time dateTime={new Date(result.timestamp * 1000).toISOString()}>
      {new Date(result.timestamp * 1000).toLocaleString()}
    </time> : null}
    <p>{result?.text || (unavailable ? 'No recent reply available.' : 'Loading latest reply…')}</p>
  </div>
}

export function BrowserSessionPreview({ session, title, disabled, children }: {
  session: SessionInfo; title: string; disabled?: boolean; children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return <Tooltip delayDuration={500} open={open && !disabled} onOpenChange={setOpen} disableHoverableContent>
    <TooltipTrigger asChild onFocusCapture={event => {
      const target = event.target as Element
      if (target.matches(':focus-visible') && !target.closest('[data-row-actions], [data-reorder-handle]')) setOpen(true)
    }} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }} onPointerEnter={event => {
      if (event.pointerType === 'touch' || (event.target as Element).closest('[data-row-actions], [data-reorder-handle]')) event.preventDefault()
    }}>{children}</TooltipTrigger>
    <TooltipContent className="browser-session-preview" side="right" align="start" sideOffset={12} boundary="viewport">
      <div className="browser-session-preview-title">{title}</div>
      <div className="browser-session-preview-meta">
        {session.model ? <span>{displayModelName(session.model)}</span> : null}
        <span>{session.message_count} messages</span>
        <span>Updated {new Date((session.last_active || session.started_at) * 1000).toLocaleString()}</span>
      </div>
      <LatestGeneration session={session} />
    </TooltipContent>
  </Tooltip>
}
