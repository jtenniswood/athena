import type { BrowserConversationModel } from './contracts/conversation'
import type { BrowserContextUsage } from './contracts/context-usage'
import { useBrowserEngine } from './engine'
import { BrowserToolbarButton } from './ui/toolbar-button'

const tokens = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

export function contextUsagePresentation(usage: BrowserContextUsage) {
  if (usage.used === null || usage.capacity === null) {
    return { percent: null, label: usage.loading ? 'Context usage: loading…' : 'Context usage unavailable' }
  }
  const percent = usage.used / usage.capacity * 100
  const estimate = usage.estimated ? 'Estimated context' : 'Context'
  return {
    percent,
    label: `${estimate} ${tokens.format(usage.used)} / ${tokens.format(usage.capacity)} (${Math.round(percent)}%)`
  }
}

/** Mounted per conversation identity so route changes also discard pending context reads. */
export function BrowserContextUsageIndicator({ conversation }: { conversation: BrowserConversationModel }) {
  const engine = useBrowserEngine()
  const usage = engine.conversations.useContextUsage(conversation)
  const { percent, label } = contextUsagePresentation(usage)
  if (!conversation.sessionId) return null
  const fill = Math.max(0, Math.min(100, percent ?? 0))
  return <BrowserToolbarButton className="browser-context-usage" tooltip={label} aria-label={label}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="browser-context-usage-track" cx="12" cy="12" r="9" strokeWidth="3" />
      {percent !== null && <circle className="browser-context-usage-fill" cx="12" cy="12" r="9" strokeWidth="3" pathLength="100" strokeDasharray={`${fill} 100`} strokeLinecap={fill > 0 ? 'round' : 'butt'} transform="rotate(-90 12 12)" />}
    </svg>
  </BrowserToolbarButton>
}
