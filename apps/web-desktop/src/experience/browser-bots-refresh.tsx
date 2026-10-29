import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { installPullToRefresh } from './ui/pull-to-refresh'
import './styles/pull-to-refresh.css'

const Refreshers = createContext<Set<() => Promise<void>> | null>(null)

/** The existing group loader acknowledges its own refresh, including failed loads. */
export function useBotsRefreshSignal(): readonly [number, () => void] {
  const refreshers = useContext(Refreshers)
  const [revision, setRevision] = useState(0)
  const sequence = useRef(0)
  const pending = useRef<{ revision: number; resolve(): void } | null>(null)
  useEffect(() => {
    if (!refreshers) return
    const refresh = () => new Promise<void>(resolve => {
      pending.current?.resolve()
      const next = ++sequence.current
      pending.current = { revision: next, resolve }; setRevision(next)
    })
    refreshers.add(refresh)
    return () => { refreshers.delete(refresh); pending.current?.resolve(); pending.current = null }
  }, [refreshers])
  const complete = useCallback(() => {
    if (pending.current?.revision === revision) { pending.current.resolve(); pending.current = null }
  }, [revision])
  return [revision, complete]
}

/** Refresh list owners in place; never reload the app or replace chat state. */
export function BrowserBotsRefresh({ children, refreshRoster }: { children: ReactNode; refreshRoster(): Promise<unknown> }) {
  const root = useRef<HTMLDivElement>(null)
  const refreshers = useRef(new Set<() => Promise<void>>()).current
  const latest = useRef(refreshRoster); latest.current = refreshRoster
  const busy = useRef(false)
  const mounted = useRef(false)
  const [distance, setDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    mounted.current = true
    const stop = installPullToRefresh(root.current!, {
      enabled: () => window.matchMedia('(pointer: coarse)').matches && root.current?.getClientRects().length !== 0,
      busy: () => busy.current,
      progress: setDistance,
      refresh: () => {
        busy.current = true; setRefreshing(true); setError(false)
        void Promise.allSettled([Promise.resolve().then(() => latest.current()), ...[...refreshers].map(refresh => Promise.resolve().then(refresh))]).then(results => {
          const failed = results.some(result => result.status === 'rejected' ||
            (result.status === 'fulfilled' && result.value && typeof result.value === 'object' && 'error' in result.value && result.value.error))
          if (mounted.current) setError(failed)
        }).finally(() => { busy.current = false; if (mounted.current) setRefreshing(false) })
      }
    })
    return () => { mounted.current = false; stop() }
  }, [refreshers])
  const height = refreshing || error ? 48 : distance
  return <Refreshers.Provider value={refreshers}>
    <div className="browser-bots-refresh" ref={root} data-browser-bots-refresh="" aria-busy={refreshing || undefined}>
      <div className="browser-pull-refresh-indicator" style={{ height }}>
        <span role={error ? 'alert' : 'status'} aria-live="polite">
          {refreshing ? 'Refreshing…' : error ? 'Could not refresh. Pull down to try again.' : distance >= 48 ? 'Release to refresh' : distance > 0 ? 'Pull to refresh' : ''}
        </span>
      </div>
      <div className="browser-bots-refresh-content">{children}</div>
    </div>
  </Refreshers.Provider>
}
