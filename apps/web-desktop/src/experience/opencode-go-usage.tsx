import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { Codicon } from '../upstream/browser-api'
import { resolveToken } from '../platform/connection'
import { runtimeConfig } from '../platform/runtime'
import { USAGE_ROUTE } from './tool-routes'
import { OpenCodeGoChart, type MonthlyUsageSample } from './opencode-go-chart'
import './opencode-go-usage.css'

const windows = [
  { id: 'rolling', label: '5-hour rolling' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' }
] as const
type Usage = Record<typeof windows[number]['id'], { percent: number; resetsAt: string }>
type UsageSnapshot = { usage: Usage; monthlyHistory?: MonthlyUsageSample[] }

const UsageContext = createContext<UsageSnapshot | null | undefined>(undefined)
const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })

function resetCountdown(resetsAt: string, now: number) {
  const remaining = Date.parse(resetsAt) - now
  if (remaining <= 0) return 'now'
  const minutes = Math.floor(remaining / 60_000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days) return `in ${days}d${hours % 24 ? ` ${hours % 24}h` : ''}`
  if (hours) return `in ${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
  return minutes ? `in ${minutes}m` : 'in less than a minute'
}

export function OpenCodeGoUsageProvider({ children }: { children: ReactNode }) {
  const enabled = runtimeConfig().capabilities.openCodeGoUsage === true
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>()

  useEffect(() => {
    if (!enabled) return
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
        const data = await response.json() as UsageSnapshot
        if (!lifetime.signal.aborted) setSnapshot(data)
      } catch {
        if (!lifetime.signal.aborted) setSnapshot(null)
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
  }, [enabled])

  return <UsageContext.Provider value={snapshot}>{children}</UsageContext.Provider>
}

export function OpenCodeGoUsage() {
  const snapshot = useContext(UsageContext)
  if (runtimeConfig().capabilities.openCodeGoUsage !== true) return null

  return <NavLink to={USAGE_ROUTE.path} state={{ fromUsageSidebar: true }} end className="browser-sidebar-footer-row">
    <Codicon name="graph" />
    <span className="min-w-0 flex-1 truncate">{USAGE_ROUTE.label}</span>
    {snapshot !== null && <span className="shrink-0 text-[0.6875rem] text-(--web-text-subtle) tabular-nums">
      {snapshot ? `${percent.format((100 - snapshot.usage.monthly.percent) / 100)} left` : 'Loading…'}
    </span>}
  </NavLink>
}

export function OpenCodeGoUsagePage() {
  const snapshot = useContext(UsageContext)
  const usage = snapshot?.usage
  const enabled = runtimeConfig().capabilities.openCodeGoUsage === true
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  const now = Date.now()

  return <div className="browser-usage-page">
    <section className="browser-usage-content" aria-labelledby="browser-usage-title">
      <h1 id="browser-usage-title" ref={heading} tabIndex={-1}>{USAGE_ROUTE.label}</h1>
      {enabled && snapshot && <OpenCodeGoChart monthly={snapshot.usage.monthly} samples={snapshot.monthlyHistory} />}
      <div className="browser-usage-limits">
        <h2>Limits</h2>
        {enabled ? <p>When your OpenCode Go usage resets</p> : <p>OpenCode Go usage is disabled on this server.</p>}
        {enabled && snapshot === undefined && <p role="status">Checking OpenCode Go usage…</p>}
        {enabled && snapshot === null && <p role="status">OpenCode Go usage is temporarily unavailable.</p>}
        {enabled && usage && <ul role="list" className="browser-usage-windows">
          {windows.map(({ id, label }) => {
            const { percent: used, resetsAt } = usage[id]
            return <li key={id} data-exhausted={used === 100 || undefined}>
              <div className="browser-usage-window">
                <strong>{label}</strong>
                <span>Resets <time dateTime={resetsAt}>{resetCountdown(resetsAt, now)}</time></span>
                <span className="browser-usage-percent">{percent.format(used / 100)} used</span>
              </div>
              <div className="browser-usage-track" aria-hidden="true"><div style={{ width: `${used}%` }} /></div>
            </li>
          })}
        </ul>}
      </div>
    </section>
  </div>
}
