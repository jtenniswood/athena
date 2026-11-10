import { useEffect, useState } from 'react'
import { Codicon, Tip } from '../upstream/browser-api'
import { resolveToken } from '../platform/connection'
import { runtimeConfig } from '../platform/runtime'

const windows = { rolling: '5-hour', weekly: 'Weekly', monthly: 'Monthly' } as const
type Usage = Record<keyof typeof windows, { percent: number; resetsAt: string }>

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const relativeTime = new Intl.RelativeTimeFormat('en')

function formatRemaining(used: number) {
  return `${percent.format((100 - used) / 100)} left`
}

function formatReset(resetsAt: string, now: number) {
  const remaining = Date.parse(resetsAt) - now
  if (remaining <= 0) return 'now'
  const minutes = Math.floor(remaining / 60_000)
  const hours = Math.floor(minutes / 60)
  if (hours >= 24) return relativeTime.format(Math.floor(hours / 24), 'day')
  if (hours >= 1) return relativeTime.format(hours, 'hour')
  if (minutes >= 1) return relativeTime.format(minutes, 'minute')
  return 'in less than a minute'
}

function UsageDetails({ usage }: { usage: Usage | null | undefined }) {
  if (usage === undefined) return <p>Checking OpenCode Go usage…</p>
  if (!usage) return <p>OpenCode Go usage is temporarily unavailable.</p>
  const now = Date.now()
  return <ul className="flex flex-col gap-2">
    {(Object.keys(windows) as (keyof typeof windows)[]).map(window => {
      const { percent: used, resetsAt } = usage[window]
      return <li key={window}>
        <div className="flex justify-between gap-3"><span>{windows[window]}</span><span>{formatRemaining(used)}</span></div>
        <div className="opacity-80">Resets <time dateTime={resetsAt}>{formatReset(resetsAt, now)}</time></div>
      </li>
    })}
  </ul>
}

function ConfiguredOpenCodeGoUsage() {
  const [usage, setUsage] = useState<Usage | null>()

  useEffect(() => {
    const lifetime = new AbortController()
    let pending = false
    const refresh = async () => {
      if (document.hidden || pending) return
      pending = true
      try {
        const token = resolveToken()
        const response = await fetch('/api/athena/opencode-go/usage', {
          headers: token ? { 'X-Hermes-Session-Token': token } : undefined,
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(13_000)])
        })
        if (!response.ok) throw new Error('Usage request failed')
        const data = await response.json() as { usage: Usage }
        if (!lifetime.signal.aborted) setUsage(data.usage)
      } catch {
        if (!lifetime.signal.aborted) setUsage(null)
      } finally {
        pending = false
      }
    }

    void refresh()
    const timer = window.setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      lifetime.abort()
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return <Tip label={<UsageDetails usage={usage} />} side="top" align="start" boundary="viewport">
    <div tabIndex={0} className="browser-sidebar-footer-row">
      <Codicon name="graph" />
      <span className="min-w-0 flex-1 truncate">Usage</span>
      {usage !== null && <span className="shrink-0 text-[0.6875rem] text-(--web-text-subtle) tabular-nums">
        {usage ? formatRemaining(usage.monthly.percent) : 'Loading…'}
      </span>}
    </div>
  </Tip>
}

export function OpenCodeGoUsage() {
  return runtimeConfig().capabilities.openCodeGoUsage === true ? <ConfiguredOpenCodeGoUsage /> : null
}
