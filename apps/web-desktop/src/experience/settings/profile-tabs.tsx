import { useId, type KeyboardEvent, type ReactNode } from 'react'
import { ActionsContextMenu, Codicon, PanelRowMenu, profileLabel, renderActionItem, useI18n, type PanelMenuItem, type ProfileInfo } from '../../upstream/browser-api'
import { Button } from '../../upstream/ui'

export function BrowserProfileSettings({ profiles, selectedName, onSelect, onCreate, onRename, onDelete, children }: {
  profiles: ProfileInfo[]
  selectedName?: string
  onSelect: (name: string) => void
  onCreate: () => void
  onRename: (profile: ProfileInfo) => void
  onDelete: (profile: ProfileInfo) => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const id = useId()
  const tabId = (name: string) => `${id}-${encodeURIComponent(name)}`
  const panelId = `${id}-detail`
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const current = tabs.indexOf(event.target as HTMLButtonElement)
    if (current < 0) return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    tabs[next].focus()
    tabs[next].click()
    tabs[next].scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return <div className="browser-profile-settings" data-browser-profile-settings="">
    <div className="browser-profile-settings-toolbar">
      <div aria-label={t.profiles.title} data-browser-profile-tabs="" className="browser-profile-settings-tabs" onKeyDown={onKeyDown} role="tablist">
        {profiles.map(profile => {
          const label = profileLabel(profile)
          const active = profile.name === selectedName
          const menuItems: PanelMenuItem[] = [
            { icon: 'edit', label: t.profiles.renameMenu, onSelect: () => onRename(profile) },
            ...(!profile.is_default ? [{ icon: 'trash', label: t.common.delete, onSelect: () => onDelete(profile), tone: 'danger' as const }] : [])
          ]
          return <ActionsContextMenu ariaLabel={label} contentClassName="w-40" key={profile.name} items={kit => menuItems.map(item => renderActionItem(kit, {
            key: item.label, label: item.label, icon: item.icon, onSelect: item.onSelect,
            variant: item.tone === 'danger' ? 'destructive' : 'default'
          }))}>
            <div className="group/row browser-profile-settings-tab" data-selected={active}>
              <button aria-controls={panelId} aria-selected={active} className="browser-settings-profile-tab" id={tabId(profile.name)} onClick={() => onSelect(profile.name)} role="tab" tabIndex={active ? 0 : -1} type="button">
                {label}
              </button>
              <PanelRowMenu items={menuItems} label={label} />
            </div>
          </ActionsContextMenu>
        })}
      </div>
      <Button onClick={onCreate} size="sm" variant="outline"><Codicon name="add" />{t.profiles.newProfile}</Button>
    </div>
    <div aria-labelledby={selectedName ? tabId(selectedName) : undefined} className="browser-profile-settings-detail" id={panelId} role="tabpanel" tabIndex={0}>
      {children}
    </div>
  </div>
}
