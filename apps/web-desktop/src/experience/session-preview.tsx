import { useEffect, useState, type ComponentProps } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger, getSessionMessages, type SessionInfo, chatMessageText, toChatMessages } from '../upstream/session-preview-api'

function formatUpdatedAge(timestamp: number) {
  const elapsedHours = Math.max(0, Math.floor((Date.now() - timestamp * 1000) / 3_600_000))
  if (elapsedHours === 0) return 'less than an hour ago'
  const days = Math.floor(elapsedHours / 24)
  const hours = elapsedHours % 24
  return [
    days ? `${days} day${days === 1 ? '' : 's'}` : '',
    hours ? `${hours} hour${hours === 1 ? '' : 's'}` : ''
  ].filter(Boolean).join(' ') + ' ago'
}

// Mounted by the tooltip portal only after an intentional hover or keyboard focus.
// A passive, owner-scoped read never selects a chat or changes its read watermark.
function LatestGeneration({ session }: { session: SessionInfo }) {
  const [result, setResult] = useState<string | null>(null)
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
      if (message) setResult(chatMessageText(message))
      else setUnavailable(true)
    }).catch(() => { if (active) setUnavailable(true) })
    return () => { active = false }
  }, [session.id, session.profile, session.connection_id, session.last_active, session.message_count])

  return <div className="browser-session-generation">
    <p>{result || (unavailable ? 'No recent reply available.' : 'Loading latest reply…')}</p>
  </div>
}

export function BrowserSessionPreview({ session, title, disabled, children, onFocusCapture, onBlurCapture, onPointerEnter, ...triggerProps }: ComponentProps<typeof TooltipTrigger> & {
  session: SessionInfo; title: string; disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return <Tooltip delayDuration={500} open={open && !disabled} onOpenChange={setOpen} disableHoverableContent>
    {/* Radix's row context-menu trigger passes its handlers and ref through this wrapper. */}
    <TooltipTrigger {...triggerProps} asChild onFocusCapture={event => {
      onFocusCapture?.(event)
      if (event.defaultPrevented) return
      const target = event.target as Element
      if (target.matches(':focus-visible') && !target.closest('[data-row-actions], [data-reorder-handle]')) setOpen(true)
    }} onBlurCapture={event => {
      onBlurCapture?.(event)
      if (event.defaultPrevented) return
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }} onPointerEnter={event => {
      onPointerEnter?.(event)
      if (event.defaultPrevented) return
      if (event.pointerType === 'touch' || (event.target as Element).closest('[data-row-actions], [data-reorder-handle]')) event.preventDefault()
    }}>{children}</TooltipTrigger>
    <TooltipContent className="browser-session-preview" side="right" align="start" alignOffset={-8} sideOffset={4} collisionPadding={24} boundary="viewport">
      <div className="browser-session-preview-title">{title}</div>
      <div className="browser-session-preview-meta">
        Updated {formatUpdatedAge(session.last_active || session.started_at)}
      </div>
      <LatestGeneration session={session} />
    </TooltipContent>
  </Tooltip>
}
