import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { Codicon } from '../upstream/browser-api'
import { resolveToken } from '../platform/connection'
import { runtimeConfig } from '../platform/runtime'
import { USAGE_ROUTE } from './tool-routes'
import './opencode-go-usage.css'

const windows = [
  { id: 'rolling', label: '5-hour rolling' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' }
] as const
type Usage = Record<typeof windows[number]['id'], { percent: number; resetsAt: string }>

const UsageContext = createContext<Usage | null | undefined>(undefined)
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
  const [usage, setUsage] = useState<Usage | null>()

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
  }, [enabled])

  return <UsageContext.Provider value={usage}>{children}</UsageContext.Provider>
}

export function OpenCodeGoUsage() {
  const usage = useContext(UsageContext)
  if (runtimeConfig().capabilities.openCodeGoUsage !== true) return null

  return <NavLink to={USAGE_ROUTE.path} state={{ fromUsageSidebar: true }} end className="browser-sidebar-footer-row">
    <Codicon name="graph" />
    <span className="min-w-0 flex-1 truncate">{USAGE_ROUTE.label}</span>
    {usage !== null && <span className="shrink-0 text-[0.6875rem] text-(--web-text-subtle) tabular-nums">
      {usage ? `${percent.format((100 - usage.monthly.percent) / 100)} left` : 'Loading…'}
    </span>}
  </NavLink>
}

export function OpenCodeGoUsagePage() {
  const usage = useContext(UsageContext)
  const enabled = runtimeConfig().capabilities.openCodeGoUsage === true
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  const now = Date.now()

  return <div className="browser-usage-page">
    <section className="browser-usage-content" aria-labelledby="browser-usage-title">
      <h1 id="browser-usage-title" ref={heading} tabIndex={-1}>{USAGE_ROUTE.label}</h1>
      <div className="browser-usage-limits">
        <h2>Limits</h2>
        {enabled ? <p>When your OpenCode Go usage resets</p> : <p>OpenCode Go usage is disabled on this server.</p>}
        {enabled && usage === undefined && <p role="status">Checking OpenCode Go usage…</p>}
        {enabled && usage === null && <p role="status">OpenCode Go usage is temporarily unavailable.</p>}
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
