import { useMemo, type ReactNode } from 'react'
import { Codicon, type OverlayNavGroup } from '../../upstream/browser-api'
import { SettingsFrameSurface, useSettingsFrame } from './frame-behavior'

type SettingsEntry = {
  active: boolean
  icon: OverlayNavGroup['icon']
  id: string
  label: string
  onSelect: () => void
  nested: boolean
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
  const { compact, showingDetail, navigation, heading, select, back } = useSettingsFrame('embedded', activeEntry?.id ?? '')

  return (
    <SettingsFrameSurface variant="embedded" title={title} closeLabel={closeLabel} onClose={onClose}>
      <header className="browser-settings-header">
        {compact && showingDetail ? (
          <button
            aria-label={backLabel}
            className="browser-settings-back"
            onClick={back}
            type="button"
          >
            <Codicon name="chevron-left" />
            <span>{backLabel}</span>
          </button>
        ) : (
          <h1>{title}</h1>
        )}
        {compact && showingDetail && <h2 ref={heading} tabIndex={-1} className="browser-settings-detail-title">{activeEntry?.label || title}</h2>}
        <div className="browser-settings-header-actions">
          {search}
          <button aria-label={closeLabel} className="browser-settings-close" onClick={onClose} type="button">
            <Codicon name="close" />
          </button>
        </div>
      </header>

      <div className="browser-settings-body">
        <aside className="browser-settings-navigation" hidden={compact && showingDetail}>
          <nav ref={navigation} aria-label={title} className="browser-settings-nav-list">
            {entries.map(entry => {
              const Icon = entry.icon
              return (
                <button
                  aria-current={entry.active ? 'page' : undefined}
                  className={`browser-settings-nav-item${entry.active ? ' is-active' : ''}${entry.nested ? ' is-nested' : ''}`}
                  key={entry.id}
                  onClick={() => select(entry.onSelect)}
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
    </SettingsFrameSurface>
  )
}
