import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { Codicon, NotificationsSettings } from '../../upstream/browser-api'
import { groupSettingsSections, isSettingsSectionVisible, orderSettingsSections, settingsPageLabel, settingsPageDescription, settingsScopeDescription } from './policy'
import { BrowserToolbarButton } from '../ui/toolbar-button'
import { BrowserColorThemesPage } from './themes-page'
import { BrowserNotificationPermissionSetting } from './notification-permission'
import { SettingsFrameSurface, useSettingsFrame } from './frame-behavior'
import './settings.css'

const PluginManager = lazy(async () => ({ default: (await import('./plugin-manager')).BrowserPluginManager }))

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

export function BrowserSettingsPresentation({ activeView, backLabel, closeLabel, groups, onClose, search, title, children }: Props) {
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const managingPlugins = activeView === 'plugins' && params.get('manage') === '1'
  const navigationGroups = groupSettingsSections<SettingsNavGroup>(groups)
  const visibleGroups = navigationGroups.flatMap(group => group.items)
  const activeGroup = visibleGroups.find(group => group.active)
  const pageDescription = settingsPageDescription(activeView) ?? `Manage ${activeGroup?.label.toLowerCase() ?? 'these'} settings.`
  const pageNotice = settingsScopeDescription(activeView)
  const activeVisible = Boolean(activeGroup)
  const pageVisible = isSettingsSectionVisible(activeView)
  const orderedActiveChildren = orderSettingsSections(activeGroup?.children ?? [])
    .filter(() => activeGroup?.id !== 'config:safety')
    .filter(child => !(activeGroup?.id === 'config:appearance' && ['config:appearance:typography', 'config:appearance:window-layout'].includes(child.id)))
    .filter(child => !(activeGroup?.id === 'config:appearance' && child.id.endsWith(':pet')))
    .map(child => ({ ...child, label: settingsPageLabel(child.id, child.label) }))
  // A single child adds a redundant stop in navigation; show its content from
  // the parent destination instead.
  const activeChildren = orderedActiveChildren.length > 1 ? orderedActiveChildren : []
  const { compact, showingDetail: showDetail, heading, navigation, select, back } = useSettingsFrame('fullscreen', activeGroup?.id ?? '')
  return <SettingsFrameSurface variant="fullscreen" title={title}
    closeLabel={closeLabel}
    onClose={onClose}
  >
    <div className="browser-settings-frame" data-browser-settings-frame="" data-browser-settings-close-label={closeLabel} role="dialog" aria-modal="true" aria-label={title}>
      <header className="browser-settings-header">
        <div className={`browser-settings-heading${compact && showDetail ? '' : ' is-settings-home'}`}>
          {compact && showDetail ? <BrowserToolbarButton
            className="browser-settings-back"
            tooltip={backLabel}
            aria-label={backLabel}
            onClick={back}
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
                  onClick={() => select(group.onSelect)}
                >
                  <Icon className="browser-settings-category-icon" />
                  <span>{group.label}</span>
                  <Codicon name="chevron-right" className="browser-settings-category-chevron" />
                </button>
                {group.active && activeChildren.map(child => {
                  const ChildIcon = child.icon
                  return <button
                    type="button"
                    className={`browser-settings-category-button is-child${child.active ? ' is-active' : ''}`}
                    aria-current={child.active ? 'page' : undefined}
                    key={child.id}
                    data-tour={`nav-${child.id}`}
                    onClick={() => select(child.onSelect)}
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
          {!showDetail && <div className="browser-settings-home">
            <h2>{title}</h2>
            <p>{activeVisible ? 'Choose a category to view and change its options.' : 'This settings category is hidden. Choose another category or close settings.'}</p>
          </div>}
          <div className="browser-settings-content-slot" data-settings-page={activeView} hidden={!showDetail} inert={!showDetail}>
            {pageVisible && activeGroup && <header className="browser-settings-page-header browser-settings-detail-header">
              <h2 className="browser-settings-page-title">{activeGroup.label}</h2>
              {activeView !== 'notifications' && <p className="browser-settings-page-description">{pageDescription}</p>}
            </header>}
            {pageVisible && pageNotice && <p className="browser-settings-page-notice" role="note">{pageNotice}</p>}
            {pageVisible && managingPlugins
              ? <Suspense fallback={<p role="status">Loading…</p>}><PluginManager /></Suspense>
              : pageVisible && activeView === 'config:browser-theme'
              ? <BrowserColorThemesPage />
              : pageVisible && activeView === 'config:browser-sounds'
                ? <NotificationsSettings subpage="sounds" />
              : pageVisible && activeView === 'notifications'
                ? <div className="browser-notification-settings"><BrowserNotificationPermissionSetting />{children}</div>
                : children}
          </div>
        </main>
      </div>
    </div>
  </SettingsFrameSurface>
}
