import { useAui, useAuiState } from '@assistant-ui/react'
import { useStore } from '@nanostores/react'
import { createContext, type PropsWithChildren, useContext, useId, useMemo, useState } from 'react'
import { useSessionView } from '@/app/chat/session-view'
import { formatElapsed, useElapsedSeconds } from '@/components/chat/activity-timer'
import { setThemeCall } from '@/components/assistant-ui/theme-picker/args'
import { connectorCalls, mcpTargets } from '@/lib/connector-tools'
import { isCardTool, isSilentTool } from '@/lib/tool-render-class'
import { $showReasoning } from '@/store/reasoning-disclosure'
import { sessionAwaitingInput } from '@/store/prompts'
import { $showToolActivity } from '@/store/tool-activity'
import { useShowAuxiliaryTranscriptContent } from './transcript-preferences'

const emptyCutoffs: Readonly<Record<string, number>> = {}
const Commentary = createContext(emptyCutoffs)

export function BrowserCommentaryPart({ children }: PropsWithChildren) {
  const cutoff = useContext(Commentary)
  const messageId = useAuiState(s => s.message.id)
  const { source, query } = useAui().part
  const isCommentary = source === 'message' && query.type === 'index' && query.index < cutoff[messageId]

  return isCommentary ? <div data-browser-commentary="">{children}</div> : children
}

/** Project the mounted response's parts without changing the renderer's message runtimes. */
export function BrowserResponseActivity({ children, indices }: PropsWithChildren<{ indices: readonly number[] }>) {
  const showAuxiliary = useShowAuxiliaryTranscriptContent()
  const showReasoning = useStore($showReasoning)
  const showTools = useStore($showToolActivity)
  const view = useSessionView()
  const busy = useStore(view.$busy)
  const atTail = useAuiState(s => indices.at(-1) === s.thread.messages.length - 1)
  const active = atTail && busy
  const signature = useAuiState(s => {
    if (!showAuxiliary) return '{}'

    const cutoffs: Record<string, number> = {}
    let hasActivity = false
    let duration: number | undefined
    const rows = indices.map(index => s.thread.messages[index])
    const lastReply = rows.findLast(row =>
      row?.role === 'assistant' && row.content.some(part => part.type === 'text' && part.text.trim())
    )

    for (const row of rows) {
      if (row?.role !== 'assistant') continue
      const custom = row.metadata?.custom
      if (typeof custom?.durationS === 'number') duration = custom.durationS

      const lastTool = row.content.findLastIndex(part => part.type === 'tool-call')
      const lastText = row.content.findLastIndex(part => part.type === 'text' && part.text.trim())
      // A settled response can end on a tool. In that case keep its last
      // available text visible. A running turn can still produce a reply.
      const cutoff = custom?.interim === true && (active || row !== lastReply)
        ? row.content.length
        : lastTool > lastText && (active || row !== lastReply)
          ? lastTool
          : lastText

      if (cutoff > 0 && row.content.slice(0, cutoff).some(part => part.type === 'text' && part.text.trim())) {
        cutoffs[row.id] = cutoff
        hasActivity = true
      }

      hasActivity ||= row.content.some(part => {
        if (part.type === 'reasoning') return showReasoning && Boolean(part.text.trim())
        return showTools && part.type === 'tool-call' && !isCardTool(part.toolName) &&
          (!isSilentTool(part.toolName) || part.isError === true) &&
          !connectorCalls(part.toolName, part.args).length && !mcpTargets(part.toolName, part.args).length &&
          !setThemeCall(part.toolName, part.args)
      })
    }

    return JSON.stringify({ cutoffs, hasActivity, duration })
  })
  const { cutoffs, hasActivity, duration } = useMemo(() => JSON.parse(signature) as {
    cutoffs?: Record<string, number>
    hasActivity?: boolean
    duration?: number
  }, [signature])
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()

  return (
    <Commentary.Provider value={cutoffs ?? emptyCutoffs}>
      {hasActivity && (
        <ResponseActivityButton
          active={active}
          contentId={contentId}
          duration={duration}
          expanded={expanded}
          onToggle={() => setExpanded(open => !open)}
        />
      )}
      <div
        className="browser-response-content"
        data-activity-collapsed={hasActivity && !expanded ? '' : undefined}
        data-activity-summary={hasActivity ? '' : undefined}
        id={contentId}
      >
        {children}
      </div>
    </Commentary.Provider>
  )
}


function ResponseActivityButton({ active, contentId, duration, expanded, onToggle }: {
  active: boolean
  contentId: string
  duration?: number
  expanded: boolean
  onToggle: () => void
}) {
  const view = useSessionView()
  const sessionId = useStore(view.$runtimeId)
  const startedAt = useStore(view.$turnStartedAt) ?? undefined
  const awaitingInput = useStore(useMemo(() => sessionAwaitingInput(sessionId), [sessionId]))
  const working = active && !awaitingInput
  const elapsed = useElapsedSeconds(working, undefined, startedAt)
  const label = active ? (awaitingInput ? 'Waiting for your input' : 'Working') : 'Response activity'
  const seconds = working ? elapsed : active ? undefined : duration

  return (
    <button
      aria-controls={contentId}
      aria-label={seconds === undefined ? label : `${label} ${formatElapsed(seconds)}`}
      aria-expanded={expanded}
      className="browser-response-activity"
      onClick={onToggle}
      type="button"
    >
      {working && <span aria-hidden="true" className="browser-response-activity-pulse" />}
      <span role="status">{label}</span>
      {seconds !== undefined && <span className="browser-response-activity-time">{formatElapsed(seconds)}</span>}
      <span aria-hidden="true" className="browser-response-activity-chevron" />
    </button>
  )
}
