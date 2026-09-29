import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { OverlayView } from '../../upstream/browser-api'
import { isSettingsFieldVisible, orderSettingsSections } from './policy'
import './settings.css'

type SettingsNavItem = {
  active: boolean
  icon: ComponentType<{ className?: string }>
  id: string
  label: string
  onSelect: () => void
}

type SettingsNavGroup = SettingsNavItem & {
  children?: SettingsNavItem[]
  gapBefore?: boolean
}

type Props = {
  activeView: string
  backLabel: string
  closeLabel: string
  groups: SettingsNavGroup[]
  actions: ReactNode
  onClose: () => void
  search: ReactNode
  title: string
  children: ReactNode
}

const COMPACT_QUERY = '(width < 56rem), (pointer: coarse) and (max-height: 27rem)'

function subscribeCompact(onChange: () => void) {
  const media = window.matchMedia(COMPACT_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function useCompactSettings() {
  return useSyncExternalStore(
    subscribeCompact,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false
  )
}

export function BrowserSettingsPresentation({ activeView, actions, backLabel, closeLabel, groups, onClose, search, title, children }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const compact = useCompactSettings()
  const location = useLocation()
  const [compactDetailOpen, setCompactDetailOpen] = useState(false)
  const [compactBackToList, setCompactBackToList] = useState(false)
  const params = new URLSearchParams(location.search)
  const hasDirectTarget = params.has('tab') || params.has('field') || params.has('setting')
  const visibleGroups = orderSettingsSections(groups)
  const activeVisible = visibleGroups.some(group => group.active)
  const showDetail = activeVisible && (!compact || compactDetailOpen || (hasDirectTarget && !compactBackToList))

  useLayoutEffect(() => {
    const root = frame.current
    if (!root) return
    const applyVisibility = () => {
      for (const element of root.querySelectorAll<HTMLElement>('[id^="setting-field-"]')) {
        const key = element.id.slice('setting-field-'.length)
        element.hidden = !isSettingsFieldVisible(key)
      }
    }
    applyVisibility()
    const observer = new MutationObserver(applyVisibility)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return <OverlayView
    closeLabel={closeLabel}
    onClose={onClose}
    rootClassName="browser-settings-fullscreen-card"
    contentClassName="browser-settings-fullscreen-content"
  >
    <div ref={frame} className="browser-settings-frame" data-browser-settings-frame="" role="dialog" aria-modal="true" aria-label={title}>
      <header className="browser-settings-header">
        {compact && showDetail && <button
          type="button"
          className="browser-settings-back"
          onClick={() => { setCompactDetailOpen(false); setCompactBackToList(true) }}
          aria-label={backLabel}
        >‹ <span>{title}</span></button>}
        {!compact && <h1>{title}</h1>}
        <div className="browser-settings-tools">
          <div className="browser-settings-search">{search}</div>
          <div className="browser-settings-actions">{actions}</div>
        </div>
      </header>
      <div className={`browser-settings-layout${compact ? ' is-compact' : ''}${showDetail ? ' show-detail' : ''}`}>
        <nav className="browser-settings-navigation" aria-label="Settings categories" hidden={compact && showDetail}>
          {visibleGroups.map(group => {
            const Icon = group.icon
            return <div className="browser-settings-category" key={group.id}>
              {group.gapBefore && <div className="browser-settings-divider" aria-hidden="true" />}
              <button
                type="button"
                className={`browser-settings-category-button${group.active ? ' is-active' : ''}`}
                aria-current={group.active ? 'page' : undefined}
                data-tour={`nav-${group.id}`}
                onClick={() => { group.onSelect(); setCompactBackToList(false); setCompactDetailOpen(true) }}
              >
                <Icon className="browser-settings-category-icon" />
                <span>{group.label}</span>
              </button>
              {group.active && group.children?.map(child => {
                const ChildIcon = child.icon
                return <button
                  type="button"
                  className={`browser-settings-category-button is-child${child.active ? ' is-active' : ''}`}
                  aria-current={child.active ? 'page' : undefined}
                  key={child.id}
                  data-tour={`nav-${child.id}`}
                  onClick={() => { child.onSelect(); setCompactBackToList(false); setCompactDetailOpen(true) }}
                >
                  <ChildIcon className="browser-settings-category-icon" />
                  <span>{child.label}</span>
                </button>
              })}
            </div>
          })}
        </nav>
        <main className="browser-settings-detail" aria-label="Settings">
          {compact && showDetail ? <div className="browser-settings-mobile-title">
            {visibleGroups.find(group => group.active)?.label ?? activeView}
          </div> : null}
          {!showDetail && <div className="browser-settings-home">
            <h2>{title}</h2>
            <p>{activeVisible ? 'Choose a category to view and change its options.' : 'This settings category is hidden. Choose another category or close settings.'}</p>
          </div>}
          <div className="browser-settings-content-slot" hidden={!showDetail} inert={!showDetail}>{children}</div>
        </main>
      </div>
    </div>
  </OverlayView>
}
