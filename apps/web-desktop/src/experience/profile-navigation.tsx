import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BrowserAppRail, reorderableRailButton, type AppRailItem } from './app-rail'
import type { BrowserProfile } from './contracts/profiles'
import { BrowserActionSurface, type BrowserActionAnchor } from './ui/action-surface'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useMobileBrowser } from './ui/use-compact-browser'
import { BotFace, avatarColor, Codicon, Tooltip, TooltipContent, TooltipTrigger } from '../upstream/browser-api'
import { useBrowserProfileMenuActions } from '../upstream/profile-layout-menu'
import { useBrowserEngine } from './engine'
import { readHideAllProfilesButton, readHiddenProfiles, writeBrowserPreference } from './browser-preferences'

function ProfileTip({ label, menuOpen, children }: { label: string; menuOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  useEffect(() => { if (menuOpen) setOpen(false) }, [menuOpen])
  return <Tooltip open={open && !menuOpen} onOpenChange={setOpen} delayDuration={200} disableHoverableContent>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    {!menuOpen && <TooltipContent>{label}</TooltipContent>}
  </Tooltip>
}

export function BrowserProfileNavigation({ hidden = false, vertical = false, combined, active = true, onActivate, onChat, controls = [] }: {
  hidden?: boolean
  vertical?: boolean
  combined: boolean
  active?: boolean
  onActivate?: (profile: string | null) => void
  onChat?: () => void
  controls?: readonly AppRailItem[]
}) {
  const engine = useBrowserEngine()
  const BrowserProfileEditor = engine.surfaces.ProfileEditor
  const model = engine.profiles.useProfiles()
  const compact = useMobileBrowser()
  const actionsTrigger = useRef<HTMLButtonElement>(null)
  const profileRail = useRef<HTMLDivElement>(null)
  const chatTrigger = useRef<HTMLButtonElement>(null)
  const focusAfterLayoutChange = useRef(false)
  const profileActions = useBrowserProfileMenuActions(combined, () => { focusAfterLayoutChange.current = true })
  useLayoutEffect(() => {
    if (!focusAfterLayoutChange.current) return
    focusAfterLayoutChange.current = false
    const rail = profileRail.current
    const target = !vertical ? actionsTrigger.current : combined ? chatTrigger.current
      : rail?.querySelector<HTMLButtonElement>('.browser-profile-choice[aria-pressed="true"]') ?? rail?.querySelector('.browser-profile-choice')
    target?.focus({ preventScroll: true })
  }, [combined, vertical])
  const [hiddenProfiles, setHiddenProfiles] = useState<string[]>(readHiddenProfiles)
  const [hideAllProfilesButton, setHideAllProfilesButton] = useState(readHideAllProfilesButton)
  const [profileContextMenuPosition, setProfileContextMenuPosition] = useState<(BrowserActionAnchor & { profile: string | null }) | null>(null)
  const [editingProfile, setEditingProfile] = useState<string | null>(null)
  const visibleProfileAvatars = model.items.filter(item => !hiddenProfiles.includes(item.key))
  const visibleFallback = model.fallback && !hiddenProfiles.includes(model.fallback.key) ? model.fallback : null
  const showAllProfiles = (model.items.length > 1 && !hideAllProfilesButton) ||
    (vertical && !visibleFallback && visibleProfileAvatars.length === 0)
  useEffect(() => { if (hidden) setProfileContextMenuPosition(null) }, [hidden])
  useEffect(() => { writeBrowserPreference('hiddenProfiles', JSON.stringify(hiddenProfiles)) }, [hiddenProfiles])
  useEffect(() => { writeBrowserPreference('hideAllProfilesButton', String(hideAllProfilesButton)) }, [hideAllProfilesButton])
  const openProfileContextMenu = (event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, profile: string | null = null) => {
    event.preventDefault()
    event.stopPropagation()
    const bounds = event.currentTarget.getBoundingClientRect()
    const atPointer = event.type === 'contextmenu' && 'clientX' in event && (event.clientX !== 0 || event.clientY !== 0)
    setProfileContextMenuPosition({
      x: atPointer ? event.clientX : bounds.left,
      y: atPointer ? event.clientY : bounds.bottom,
      returnFocus: event.currentTarget,
      profile
    })
  }
  const onProfileMenuKey = (event: React.KeyboardEvent<HTMLButtonElement>, profile: string | null = null) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openProfileContextMenu(event, profile)
  }
  const activateProfile = onActivate ?? model.select
  const toggleProfile = (profileName: string) => {
    const isHidden = hiddenProfiles.includes(profileName)
    setHiddenProfiles(current => isHidden
      ? current.filter(name => name !== profileName)
      : [...current, profileName])
    if (!isHidden && !model.all && model.active === profileName) {
      model.select(visibleProfileAvatars.find(item => item.key !== profileName)?.key ?? null)
    }
  }
  const profileItems = model.fallback ? [...model.items, model.fallback] : model.items
  const menuOpen = profileContextMenuPosition !== null
  const dragProps = vertical ? reorderableRailButton : { draggable: false }
  const chatButton = combined && <ProfileTip menuOpen={menuOpen} label="Chat">
    <BrowserToolbarButton {...reorderableRailButton} ref={chatTrigger} aria-label="Chat" aria-current={active ? 'page' : undefined}
      aria-haspopup="menu" onClick={onChat} onContextMenu={event => openProfileContextMenu(event)} onKeyDown={event => onProfileMenuKey(event)}>
      <Codicon name="comment" />
    </BrowserToolbarButton>
  </ProfileTip>
  const allButton = showAllProfiles && <ProfileTip menuOpen={menuOpen} label="All profiles">
    <button {...dragProps} className="browser-profile-choice browser-profile-all" type="button" aria-label="All profiles"
      aria-pressed={active && model.all} onClick={() => activateProfile(null)} onContextMenu={event => openProfileContextMenu(event)}
      onKeyDown={event => onProfileMenuKey(event)}><Codicon name="symbol-misc" size="1rem" /></button>
  </ProfileTip>
  const profileButton = (item: BrowserProfile, fallback = false) => <ProfileTip menuOpen={menuOpen} label={item.label}>
    <button {...dragProps} className="browser-profile-choice" data-profile-key={fallback ? undefined : item.key} type="button"
      aria-label={item.label} aria-pressed={active && (fallback || (!model.all && model.active === item.key))}
      onClick={() => activateProfile(item.key)} onContextMenu={event => openProfileContextMenu(event, item.key)}
      onKeyDown={event => onProfileMenuKey(event, item.key)}>
      <BotFace color={avatarColor(item.appearance.color, item.botName)} image={item.appearance.image} name={item.botName} shape={item.appearance.shape} size={28} />
    </button>
  </ProfileTip>
  const profileKey = (name: string) => `profile:${name}`
  function syncProfileOrder(key: string, order: string[]) {
    const names = new Map(model.items.map(item => [profileKey(item.key), item.key]))
    const source = names.get(key)
    if (source === undefined) return
    const profiles = order.flatMap(id => names.has(id) ? [names.get(id)!] : [])
    const index = profiles.indexOf(source)
    // Keep the renderer's profile order in sync for the mobile profile bar.
    if (index === model.items.findIndex(item => item.key === source)) return
    const next = profiles[index + 1]
    const previous = profiles[index - 1]
    if (next !== undefined) model.reorder(source, next, false)
    else if (previous !== undefined) model.reorder(source, previous, true)
  }

  return <>
    {vertical ? <BrowserAppRail rail={profileRail} onMove={syncProfileOrder}
      onContextMenu={event => { if (!combined && event.target === event.currentTarget) openProfileContextMenu(event) }}
      items={[
        { key: 'chat', button: chatButton || null },
        { key: 'all-profiles', button: combined ? null : allButton || null },
        ...(model.fallback ? [{ key: profileKey(model.fallback.key), button: !combined && visibleFallback ? profileButton(visibleFallback, true) : null }] : []),
        ...model.items.map(item => ({ key: profileKey(item.key), button: !combined && !hiddenProfiles.includes(item.key) ? profileButton(item) : null })),
        ...controls
      ]}
    /> : <div className="browser-profile-footer" hidden={hidden}>
      {!combined && <div className="browser-profile-rail" role="radiogroup" aria-label="Profiles" onContextMenu={event => openProfileContextMenu(event)}>
        {allButton}
        {visibleFallback && profileButton(visibleFallback, true)}
        {visibleProfileAvatars.map(item => <div className="browser-profile-slot" key={item.key}>{profileButton(item)}</div>)}
      </div>}
      <BrowserToolbarButton tooltip="Profile actions" ref={actionsTrigger} className="browser-profile-actions-trigger ml-auto" type="button" aria-label="Profile actions"
        aria-haspopup={compact ? 'dialog' : 'menu'} aria-expanded={menuOpen} onClick={event => openProfileContextMenu(event)}><Codicon name="ellipsis" size="1rem" /></BrowserToolbarButton>
    </div>}
    <BrowserActionSurface
      title="Profile actions"
      hideTitle
      anchor={profileContextMenuPosition}
      compact={compact}
      fallbackFocus={vertical ? (combined ? chatTrigger : profileRail) : actionsTrigger}
      onClose={() => setProfileContextMenuPosition(null)}
      groups={[
        {
          key: 'manage',
          actions: [
            ...(profileContextMenuPosition?.profile ? [{
              key: 'edit-profile',
              label: 'Edit profile',
              icon: <Codicon name="edit" size="1rem" />,
              afterClose: true,
              run: () => setEditingProfile(profileContextMenuPosition.profile)
            }] : []),
            ...profileActions.manage
          ]
        },
        {
          key: 'view',
          actions: [profileActions.layout, ...(!combined ? [{
            key: 'visible-profiles',
            label: 'Profiles',
            icon: <Codicon name="organization" />,
            run: () => {},
            children: [{
              key: 'profile-visibility',
              actions: [
                {
                  key: 'all-profiles',
                  label: 'All Profiles',
                  icon: <Codicon name="organization" size="1rem" />,
                  checked: !hideAllProfilesButton,
                  keepOpen: true,
                  run: () => setHideAllProfilesButton(value => !value)
                },
                ...profileItems.map(item => ({
                  key: `profile-${item.key}`,
                  label: item.label,
                  icon: <Codicon name="account" size="1rem" />,
                  checked: !hiddenProfiles.includes(item.key),
                  keepOpen: true,
                  run: () => toggleProfile(item.key)
                }))
              ]
            }]
          }] : [])]
        }
      ]}
    />
    <BrowserProfileEditor profile={editingProfile} onClose={() => setEditingProfile(null)} />
  </>
}
