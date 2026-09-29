import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Codicon, type OverlayNavGroup } from '../../upstream/browser-api'
import { useBrowserOverlayFocus } from '../ui/overlay-focus'
import { useCompactBrowser } from '../ui/use-compact-browser'

type SettingsEntry = {
  active: boolean
  icon: OverlayNavGroup['icon']
  id: string
  label: string
  onSelect: () => void
  nested: boolean
}

function routeHasSettingsDestination(search: string): boolean {
  const params = new URLSearchParams(search)
  return ['tab', 'pview', 'kview', 'setting', 'field'].some(key => params.has(key))
}

export function BrowserSettingsFrame({
  backLabel,
  children,
  closeLabel,
  footer,
  groups,
  onClose,
  search,
  title
}: {
  backLabel: string
  children: ReactNode
  closeLabel: string
  footer?: ReactNode
  groups: OverlayNavGroup[]
  onClose: () => void
  search: ReactNode
  title: string
}) {
  const compact = useCompactBrowser()
  const location = useLocation()
  const surface = useBrowserOverlayFocus()
  const activeNavItem = useRef<HTMLButtonElement>(null)
  const entries = useMemo<SettingsEntry[]>(() => groups.flatMap(group => {
    const childActive = group.children?.some(child => child.active) ?? false
    return [
      {
        active: group.active && !childActive,
        icon: group.icon,
        id: group.id,
        label: group.label,
        onSelect: group.onSelect,
        nested: false
      },
      ...(group.children ?? []).map(child => ({ ...child, nested: true }))
    ]
  }), [groups])
  const activeEntry = entries.find(entry => entry.active)
  const activeIdentity = activeEntry?.id || ''
  const [showingDetail, setShowingDetail] = useState(() => !compact || routeHasSettingsDestination(location.search))
  const previousActiveIdentity = useRef(activeIdentity)

  useEffect(() => {
    if (activeIdentity !== previousActiveIdentity.current) {
      previousActiveIdentity.current = activeIdentity
      if (activeIdentity) setShowingDetail(true)
    }
  }, [activeIdentity])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <section
      aria-label={title}
      aria-modal="true"
      className="browser-settings-surface"
      data-overlay-surface=""
      ref={surface}
      role="dialog"
      tabIndex={-1}
    >
      <header className="browser-settings-header">
        {compact && showingDetail ? (
          <button
            aria-label={backLabel}
            className="browser-settings-back"
            onClick={() => {
              setShowingDetail(false)
              window.requestAnimationFrame(() => activeNavItem.current?.focus())
            }}
            type="button"
          >
            <Codicon name="chevron-left" />
            <span>{backLabel}</span>
          </button>
        ) : (
          <h1>{title}</h1>
        )}
        {compact && showingDetail && <h2 className="browser-settings-detail-title">{activeEntry?.label || title}</h2>}
        <div className="browser-settings-header-actions">
          {search}
          <button aria-label={closeLabel} className="browser-settings-close" onClick={onClose} type="button">
            <Codicon name="close" />
          </button>
        </div>
      </header>

      <div className="browser-settings-body">
        <aside className="browser-settings-navigation" hidden={compact && showingDetail}>
          <nav aria-label={title} className="browser-settings-nav-list">
            {entries.map(entry => {
              const Icon = entry.icon
              return (
                <button
                  aria-current={entry.active ? 'page' : undefined}
                  className={`browser-settings-nav-item${entry.active ? ' is-active' : ''}${entry.nested ? ' is-nested' : ''}`}
                  key={entry.id}
                  ref={entry.active ? activeNavItem : undefined}
                  onClick={() => {
                    setShowingDetail(true)
                    entry.onSelect()
                  }}
                  type="button"
                >
                  <Icon aria-hidden className="browser-settings-nav-icon" />
                  <span>{entry.label}</span>
                </button>
              )
            })}
          </nav>
          {footer && <div className="browser-settings-footer">{footer}</div>}
        </aside>
        <main className="browser-settings-content" hidden={compact && !showingDetail}>
          {children}
        </main>
      </div>
    </section>
  )
}
