import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Codicon, OverlayView } from '../../upstream/browser-api'
import { groupSettingsSections, isSettingsSectionVisible, orderSettingsSections, settingsPageLabel, settingsScopeDescription } from './policy'
import { BrowserToolbarButton } from '../ui/toolbar-button'
import { BrowserColorThemesPage } from './themes-page'
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
  onClose: () => void
  search: ReactNode
  title: string
  children: ReactNode
}

type CompactPresentation =
  | { mode: 'automatic' }
  | { mode: 'menu'; locationKey: string }
  | { mode: 'detail' }

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

export function BrowserSettingsPresentation({ activeView, backLabel, closeLabel, groups, onClose, search, title, children }: Props) {
  const frame = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const navigation = useRef<HTMLElement>(null)
  const moveFocus = useRef(false)
  const compact = useCompactSettings()
  const location = useLocation()
  const [compactPresentation, setCompactPresentation] = useState<CompactPresentation>({ mode: 'automatic' })
  const params = new URLSearchParams(location.search)
  const hasDirectTarget = params.has('tab') || params.has('field') || params.has('setting')
  const opensDefaultSettingsTab = !hasDirectTarget && activeView === 'config:appearance'
  const navigationGroups = groupSettingsSections(groups)
  const visibleGroups = navigationGroups.flatMap(group => group.items)
  const activeGroup = visibleGroups.find(group => group.active)
  const pageNotice = settingsScopeDescription(activeView)
  const activeVisible = Boolean(activeGroup)
  const pageVisible = isSettingsSectionVisible(activeView)
  const orderedActiveChildren = orderSettingsSections(activeGroup?.children ?? [])
    .filter(child => !(activeGroup?.id === 'config:appearance' && ['config:appearance:typography', 'config:appearance:window-layout'].includes(child.id)))
    .filter(child => !(activeGroup?.id === 'config:appearance' && child.id.endsWith(':pet')))
    .map(child => ({ ...child, label: settingsPageLabel(child.id, child.label) }))
  // A single child adds a redundant stop in navigation; show its content from
  // the parent destination instead.
  const activeChildren = orderedActiveChildren.length > 1 ? orderedActiveChildren : []
  const directTargetOpensDetail = (hasDirectTarget || opensDefaultSettingsTab)
    && (compactPresentation.mode === 'automatic' || (compactPresentation.mode === 'menu' && compactPresentation.locationKey !== location.key))
  const showDetail = activeVisible && (!compact || compactPresentation.mode === 'detail' || directTargetOpensDetail)

  useLayoutEffect(() => {
    if (!compact || !moveFocus.current) return
    moveFocus.current = false
    if (showDetail) heading.current?.focus()
    else navigation.current?.querySelector<HTMLButtonElement>('[aria-current="page"]')?.focus()
  }, [compact, showDetail, activeView])

  const selectCategory = (item: SettingsNavItem) => {
    moveFocus.current = compact
    item.onSelect()
    setCompactPresentation({ mode: 'detail' })
  }

  return <OverlayView
    closeLabel={closeLabel}
    onClose={onClose}
    rootClassName="browser-settings-fullscreen-card"
    contentClassName="browser-settings-fullscreen-content"
  >
    <div ref={frame} className="browser-settings-frame" data-browser-settings-frame="" role="dialog" aria-modal="true" aria-label={title}>
      <header className="browser-settings-header">
        <div className={`browser-settings-heading${compact && showDetail ? '' : ' is-settings-home'}`}>
          {compact && showDetail ? <BrowserToolbarButton
            className="browser-settings-back"
            tooltip={backLabel}
            aria-label={backLabel}
            onClick={() => {
              moveFocus.current = true
              setCompactPresentation({ mode: 'menu', locationKey: location.key })
            }}
          ><Codicon name="arrow-left" /></BrowserToolbarButton> : null}
          <h1 ref={heading} tabIndex={-1} className={compact && showDetail ? 'browser-settings-mobile-title' : undefined}>
            {compact && showDetail ? activeGroup?.label ?? activeView : title}
          </h1>
        </div>
        {(!compact || !showDetail) && <div className="browser-settings-search">{search}</div>}
      </header>
      <div className={`browser-settings-layout${compact ? ' is-compact' : ''}${showDetail ? ' show-detail' : ''}`}>
        <nav ref={navigation} className="browser-settings-navigation" aria-label="Settings categories" hidden={compact && showDetail}>
          <div className="browser-settings-category-list">
            {navigationGroups.map(section => <section className="browser-settings-nav-group" key={section.id} aria-labelledby={`settings-group-${section.id}`}>
            <h2 className="browser-settings-group-heading" id={`settings-group-${section.id}`}>{section.label}</h2>
            {section.items.map(group => {
              const Icon = group.icon
              return <div className="browser-settings-category" key={group.id}>
                <button
                  type="button"
                  className={`browser-settings-category-button${group.active ? ' is-active' : ''}`}
                  aria-current={group.active ? 'page' : undefined}
                  data-tour={`nav-${group.id}`}
                  onClick={() => selectCategory(group)}
                >
                  <Icon className="browser-settings-category-icon" />
                  <span>{group.label}</span>
                  <Codicon name="chevron-right" className="browser-settings-category-chevron" />
                </button>
                {!compact && group.active && activeChildren.map(child => {
                  const ChildIcon = child.icon
                  return <button
                    type="button"
                    className={`browser-settings-category-button is-child${child.active ? ' is-active' : ''}`}
                    aria-current={child.active ? 'page' : undefined}
                    key={child.id}
                    data-tour={`nav-${child.id}`}
                    onClick={() => selectCategory(child)}
                  >
                    <ChildIcon className="browser-settings-category-icon" />
                    <span>{child.label}</span>
                  </button>
                })}
              </div>
            })}
            </section>)}
          </div>
        </nav>
        <main className="browser-settings-detail" aria-label={activeGroup?.label ?? title}>
          {compact && showDetail && activeChildren.length > 0 && <nav className="browser-settings-subnavigation" aria-label={`${activeGroup?.label} categories`}>
            {activeChildren.map(child => <button key={child.id} type="button" aria-current={child.active ? 'page' : undefined} onClick={() => selectCategory(child)}>{child.label}</button>)}
          </nav>}
          {!showDetail && <div className="browser-settings-home">
            <h2>{title}</h2>
            <p>{activeVisible ? 'Choose a category to view and change its options.' : 'This settings category is hidden. Choose another category or close settings.'}</p>
          </div>}
          <div className="browser-settings-content-slot" hidden={!showDetail} inert={!showDetail}>
            {pageVisible && pageNotice && <p className="browser-settings-page-notice" role="note">{pageNotice}</p>}
            {pageVisible && activeView === 'config:appearance' && activeChildren.some(child => child.active && child.id === 'config:appearance:theme')
              ? <BrowserColorThemesPage /> : children}
          </div>
        </main>
      </div>
    </div>
  </OverlayView>
}
