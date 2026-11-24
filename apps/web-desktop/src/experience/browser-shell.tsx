import { useSidebarGestures } from './sidebar-gestures'
import { useBrowserEngine } from './engine'
import { useChatPanelSettings } from './settings/chat-panel-page'
import { BrowserNewChatProfileSelector } from './new-chat-profile-selector'
import { BrowserProfileNavigation } from './profile-navigation'
import { isAndroidApp } from '../platform/android'
import { BrowserToolModal } from './tool-modal'
import { KANBAN_ROUTE } from './tool-routes'
import { AppSettingsRegistration, SettingsLink } from './settings-menu'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { BrowserNavigationTabs, BrowserNavigationResizer, useBrowserNavigation } from './navigation'
import { BrowserActionError } from './action-errors'
import { ARCHIVE_TOASTS_ID, BrowserArchiveToasts } from './archive-toast'
import { BrowserArchiveConfirmation } from './archive-confirmation'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { BrowserSidebarNavigation } from './sidebar-extras'
import { BrowserSessionsPane } from './sidebar-sections'
import { BrowserBotsFallback } from './browser-bots-fallback'
import { installTranscriptPreferences } from './transcript-preferences'
import { Codicon, SidebarProvider } from '../upstream/browser-api'
import { BrowserChatActionsMenu } from './chat-actions-menu'
import { currentPwaUpdate, subscribePwaUpdate, type PwaUpdateNotice } from '../pwa/register'

export function BrowserShell() {
  const { surfaces: { Host } } = useBrowserEngine()
  const { pathname } = useLocation()
  // Old Usage links would otherwise be interpreted as chat IDs.
  if (pathname === '/usage' || pathname === '/usage/') return <Navigate to="/" replace />
  return <SidebarProvider className="browser-provider" style={{ '--sidebar-width': '100%' } as CSSProperties}>
    <Host><BrowserLayout /></Host>
  </SidebarProvider>
}
function BrowserLayout() {
  const engine = useBrowserEngine()
  const { Sessions: BrowserSessionsSurface, Bots: BrowserBotsSurface, Conversation: BrowserConversationSurface, Status: BrowserStatusSurface, Page: BrowserPageSurface } = engine.surfaces
  const presentationMode = engine.profiles.useGrouping()
  useEffect(() => installTranscriptPreferences(), [])
  const navigate = useNavigate(), location = useLocation()
  const kanban = location.pathname === KANBAN_ROUTE.path
  const settings = location.pathname === '/settings'
  const chatSelected = !kanban && !settings
  const coversWorkspace = engine.navigation.coversWorkspace(location.pathname)
  const lastChat = useRef<{ url: string; state: unknown }>({ url: '/', state: null })
  useLayoutEffect(() => {
    if (!coversWorkspace) lastChat.current = { url: location.pathname + location.search + location.hash, state: location.state }
  }, [coversWorkspace, location])
  const conversation = engine.conversations.useCurrent()
  const sessionActions = engine.conversations.useActions(conversation)
  const chatTitle = conversation.displayName || ''
  const panels = engine.navigation.usePanels()
  const main = useRef<HTMLElement>(null), menu = useRef<HTMLButtonElement>(null)
  const rail = useRef<HTMLElement>(null)
  const archiveToasts = useRef<HTMLDivElement>(null)
  const navigation = useBrowserNavigation({ selectionKey: conversation.selectionKey, path: location.pathname, main, trigger: menu, rail, archiveToasts })
  const inlineKanban = kanban && !navigation.mobile
  const profiles = engine.profiles.useProfiles()
  const preventSessionPaneDrag = useSidebarGestures(navigation.drawer, engine.projects,
    JSON.stringify([profiles.active, profiles.all, presentationMode, navigation.tab, navigation.open, location.pathname]))
  useChatPanelSettings(navigation)
  engine.useEnvironment(conversation,
    !(navigation.compact && navigation.drawerOpen) && !settings && !kanban)
  const { tab } = navigation
  const drawerModal = navigation.compact && navigation.drawerOpen
  const drawerOwnedElements = navigation.mobile ? ARCHIVE_TOASTS_ID : `browser-app-navigation ${ARCHIVE_TOASTS_ID}`
  const [updateNotice, setUpdateNotice] = useState<PwaUpdateNotice | null>(() => currentPwaUpdate())
  const [updateDismissed, setUpdateDismissed] = useState(false)
  useEffect(() => subscribePwaUpdate(notice => {
    setUpdateNotice(notice)
    if (notice) setUpdateDismissed(false)
  }), [])
  const openRoute = (path: string) => {
    engine.navigation.openPage(navigate, path)
    navigation.closeDrawer()
  }
  const openChat = () => {
    if (coversWorkspace) void navigate(lastChat.current.url, { state: lastChat.current.state })
    else navigation.showHistory()
  }
  const openProfileChat = (profile: string | null) => {
    const switchingProfile = profile !== null && (profiles.all || profiles.active !== profile)
    if (coversWorkspace && switchingProfile) void navigate('/')
    else openChat()
    profiles.select(profile)
  }
  return <div className="browser-shell" data-browser-shell="" data-android-app={isAndroidApp() || undefined} data-browser-conversation-kind={conversation.kind} data-browser-conversation-id={conversation.id || undefined}>
    <BrowserActionError />
    <BrowserArchiveConfirmation />
    <AppSettingsRegistration />
    <div className="browser-workspace">
      {!navigation.mobile && <nav id="browser-app-navigation" className="browser-app-navigation" aria-label="App navigation" ref={rail}>
        <img src="/athena.svg" alt="Athena" width={32} height={32} className="shrink-0" />
        {presentationMode ? <BrowserToolbarButton tooltip="Chat" aria-label="Chat" aria-current={chatSelected ? 'page' : undefined} onClick={openChat}>
          <Codicon name="comment" />
        </BrowserToolbarButton> : <BrowserProfileNavigation vertical active={chatSelected} onActivate={openProfileChat} />}
        <BrowserToolbarButton tooltip={KANBAN_ROUTE.label} aria-label={KANBAN_ROUTE.label} aria-current={kanban ? 'page' : undefined} onClick={() => { if (!kanban) openRoute(KANBAN_ROUTE.path) }}>
          <Codicon name={KANBAN_ROUTE.icon} />
        </BrowserToolbarButton>
        <SettingsLink onOpenRoute={openRoute} triggerRef={navigation.actionsTrigger} active={settings} />
      </nav>}
      {navigation.compact && !navigation.mobile && navigation.drawerOpen && <button type="button" className="browser-scrim" aria-label="Dismiss navigation" tabIndex={-1} onClick={navigation.dismissDrawer} />}
      <aside id="browser-navigation" ref={navigation.drawer} tabIndex={navigation.compact ? -1 : undefined} onPointerDownCapture={preventSessionPaneDrag} hidden={!navigation.open || (!navigation.mobile && !chatSelected)} className={`browser-navigation ${navigation.drawerOpen ? 'is-open' : ''}`} role={drawerModal ? 'dialog' : undefined} aria-modal={drawerModal || undefined} aria-owns={drawerModal ? drawerOwnedElements : undefined} aria-label="Navigation" style={{ '--browser-navigation-width': `${navigation.width}px` } as CSSProperties}>
        {navigation.mobile && <nav className="browser-mobile-titlebar" aria-label="App shortcuts">
          <BrowserToolbarButton tooltip={KANBAN_ROUTE.label} aria-label={KANBAN_ROUTE.label} onClick={() => openRoute(KANBAN_ROUTE.path)}>
            <Codicon name={KANBAN_ROUTE.icon} />
          </BrowserToolbarButton>
          <SettingsLink onOpenRoute={openRoute} triggerRef={navigation.actionsTrigger} />
          <img src="/athena.svg" alt="Athena" width={32} height={32} className="shrink-0" />
        </nav>}
        <BrowserNavigationTabs navigation={navigation} />
        <div className="browser-navigation-body" data-profile-layout={presentationMode ? 'combined' : 'separate'} role="tabpanel" aria-label={tab}>
          <BrowserSessionsPane hidden={tab !== 'sessions'} sections={navigation.sections}>
            <BrowserSidebarNavigation searchFocusRequest={navigation.searchFocusRequest}>
              <BrowserSessionsSurface />
            </BrowserSidebarNavigation>
          </BrowserSessionsPane>
          <div hidden={tab !== 'bots'} className="browser-pane"><BrowserBotsSurface fallback={<BrowserBotsFallback />} /></div>
        </div>
        {updateNotice && !updateDismissed && <div className="browser-update-panel" role="status" aria-label="Application update">
          <div className="browser-update-panel-heading">
            <strong>{updateNotice.phase === 'updating' ? 'Reloading interface…' : 'Update available'}</strong>
            {updateNotice.phase === 'available' && <button type="button" aria-label="Dismiss update" onClick={() => setUpdateDismissed(true)}>×</button>}
          </div>
          <p>{updateNotice.message}</p>
          {updateNotice.phase === 'available' && <button type="button" className="browser-update-panel-action" onClick={updateNotice.update}>Update</button>}
        </div>}
        {navigation.mobile && !presentationMode && <BrowserProfileNavigation hidden={tab !== 'sessions'} />}
      </aside>
      {chatSelected && <BrowserNavigationResizer navigation={navigation} />}
      <main className="browser-main" ref={main} hidden={navigation.mobile && navigation.drawerOpen} inert={navigation.compact && !navigation.mobile && navigation.drawerOpen} tabIndex={-1} aria-label={inlineKanban ? KANBAN_ROUTE.label : 'Conversation and workspace'}>
        {!inlineKanban && <div className="browser-chat-toolbar" aria-label="Chat toolbar">
          <BrowserToolbarButton tooltip={navigation.mobile ? 'Back to chat history' : navigation.open ? 'Hide sidebar' : 'Show sidebar'} className="browser-menu" ref={menu} aria-label={navigation.mobile ? 'Back to chat history' : navigation.open ? 'Hide navigation' : 'Open navigation'} aria-expanded={navigation.mobile ? undefined : navigation.open} aria-controls="browser-navigation" onClick={navigation.mobile ? navigation.backToHistory : navigation.toggle}>
            <Codicon name={navigation.mobile ? 'arrow-left' : 'layout-sidebar-left'} />
          </BrowserToolbarButton>
          <div className="browser-actions">
            {location.pathname === '/' && <BrowserNewChatProfileSelector iconOnly={navigation.mobile} />}
            <BrowserChatActionsMenu actions={sessionActions} title={chatTitle} panels={panels} main={main} />
          </div>
        </div>}
        <div className="browser-chat-workspace" hidden={inlineKanban}>
          <BrowserConversationSurface />
          <div className="browser-status"><BrowserStatusSurface /></div>
        </div>
        {inlineKanban && <div className="browser-page pt-2"><BrowserPageSurface /></div>}
      </main>
      <BrowserToolModal mobile={navigation.mobile} chatUrl={lastChat.current.url} />
      <BrowserArchiveToasts ref={archiveToasts} />
    </div>
  </div>
}
