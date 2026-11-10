import { useEffect, useState } from 'react'
import { Codicon, Popover, PopoverContent, PopoverTrigger, Tip } from '../upstream/browser-api'
import { resolveToken } from '../platform/connection'
import { runtimeConfig } from '../platform/runtime'

const windows = { rolling: '5-hour', weekly: 'Weekly', monthly: 'Monthly' } as const
type Usage = Record<keyof typeof windows, { percent: number; resetsAt: string }>

const percent = new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 1 })
const resetTime = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
})

function UsageDetails({ usage }: { usage: Usage | null | undefined }) {
  if (usage === undefined) return <p>Checking OpenCode Go usage…</p>
  if (!usage) return <p>OpenCode Go usage is temporarily unavailable.</p>
  return <ul className="flex flex-col gap-2">
    {(Object.keys(windows) as (keyof typeof windows)[]).map(window => {
      const { percent: used, resetsAt } = usage[window]
      return <li key={window}>
        <div className="flex justify-between gap-3"><span>{windows[window]}</span><span>{percent.format(used / 100)} used</span></div>
        <div className="opacity-80">Resets <time dateTime={resetsAt}>{resetTime.format(new Date(resetsAt))}</time></div>
      </li>
    })}
  </ul>
}

function ConfiguredOpenCodeGoUsage() {
  const [usage, setUsage] = useState<Usage | null>()
  const [open, setOpen] = useState(false)

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

  return <Popover open={open} onOpenChange={setOpen}>
    <Tip label={<UsageDetails usage={usage} />} side="top" align="start" boundary="viewport" hidden={open}>
      <PopoverTrigger type="button" className="flex h-(--browser-session-control-height) w-full items-center gap-2 rounded-md px-2 text-left text-[0.8125rem] font-medium text-(--web-text-muted) hover:bg-(--ui-control-hover-background) hover:text-foreground pointer-coarse:min-h-(--web-touch-min)">
        <Codicon name="graph" className="size-4 shrink-0 text-[color-mix(in_srgb,currentColor_72%,transparent)]" />
        <span className="min-w-0 flex-1 truncate">OpenCode Go</span>
        <span className="flex shrink-0 flex-col items-end text-xs leading-tight tabular-nums">
          {usage ? <>
            <span>{percent.format((100 - usage.monthly.percent) / 100)} left</span>
            <span className="text-[0.625rem] opacity-80">This month</span>
          </> : usage === null ? 'Unavailable' : 'Loading…'}
        </span>
      </PopoverTrigger>
    </Tip>
    {/* The portaled details must sit above the mobile sidebar drawer. */}
    <PopoverContent side="top" align="start" aria-label="OpenCode Go usage" className="z-70 w-auto min-w-48 text-xs">
      <UsageDetails usage={usage} />
    </PopoverContent>
  </Popover>
}

export function OpenCodeGoUsage() {
  return runtimeConfig().capabilities.openCodeGoUsage === true ? <ConfiguredOpenCodeGoUsage /> : null
}
