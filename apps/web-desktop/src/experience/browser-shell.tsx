import { useSidebarGestures } from './sidebar-gestures'
import { useBrowserEngine } from './engine'
import { useChatPanelSettings } from './settings/chat-panel-page'
import { BrowserProfileNavigation } from './profile-navigation'
import { isAndroidApp } from '../platform/android'
import { BrowserToolModal } from './tool-modal'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { BrowserNavigationTabs, BrowserNavigationSettings, BrowserNavigationResizer, useBrowserNavigation } from './navigation'
import { BrowserActionError } from './action-errors'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { BrowserSidebarNavigation } from './sidebar-extras'
import { BrowserSessionsPane } from './sidebar-sections'
import { BrowserBotsFallback } from './browser-bots-fallback'
import { installTranscriptPreferences } from './transcript-preferences'
import { Codicon, SidebarProvider } from '../upstream/browser-api'
import { BrowserChatActionsMenu } from './chat-actions-menu'
import { currentPwaUpdate, subscribePwaUpdate, type PwaUpdateNotice } from '../pwa/register'

export function BrowserShell() {
  const { surfaces: { Host } } = useBrowserEngine()
  return <SidebarProvider className="browser-provider" style={{ '--sidebar-width': '100%' } as CSSProperties}>
    <Host><BrowserLayout /></Host>
  </SidebarProvider>
}
function BrowserLayout() {
  const engine = useBrowserEngine()
  const { Sessions: BrowserSessionsSurface, Bots: BrowserBotsSurface, Conversation: BrowserConversationSurface, Status: BrowserStatusSurface } = engine.surfaces
  const presentationMode = engine.profiles.useGrouping()
  useEffect(() => installTranscriptPreferences(), [])
  const navigate = useNavigate(), location = useLocation()
  const conversation = engine.conversations.useCurrent()
  const sessionActions = engine.conversations.useActions(conversation)
  const chatTitle = conversation.displayName || ''
  const panels = engine.navigation.usePanels()
  const main = useRef<HTMLElement>(null), menu = useRef<HTMLButtonElement>(null)
  const navigation = useBrowserNavigation({ selectionKey: conversation.selectionKey, path: location.pathname, main, trigger: menu })
  const profiles = engine.profiles.useProfiles()
  const preventSessionPaneDrag = useSidebarGestures(navigation.drawer, engine.projects,
    JSON.stringify([profiles.active, profiles.all, presentationMode, navigation.tab, navigation.open, location.pathname]))
  useChatPanelSettings(navigation)
  engine.useEnvironment(conversation,
    !((navigation.mobile || navigation.compact) && navigation.drawerOpen) && !location.pathname.startsWith('/settings'))
  const { tab } = navigation
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
  return <div className="browser-shell" data-browser-shell="" data-android-app={isAndroidApp() || undefined} data-browser-conversation-kind={conversation.kind} data-browser-conversation-id={conversation.id || undefined}>
    <BrowserActionError />
    <div className="browser-workspace">
      {navigation.compact && !navigation.mobile && navigation.drawerOpen && <button type="button" className="browser-scrim" aria-label="Dismiss navigation" tabIndex={-1} onClick={navigation.dismissDrawer} />}
      <aside id="browser-navigation" ref={navigation.drawer} onPointerDownCapture={preventSessionPaneDrag} hidden={!navigation.open} className={`browser-navigation ${navigation.drawerOpen ? 'is-open' : ''}`} role={navigation.compact && navigation.drawerOpen ? 'dialog' : undefined} aria-modal={navigation.compact && navigation.drawerOpen ? true : undefined} aria-label="Navigation" style={{ '--browser-navigation-width': `${navigation.width}px` } as CSSProperties}>
        <BrowserNavigationTabs navigation={navigation} actions={tab !== 'sessions' ? <BrowserNavigationSettings navigation={navigation} onOpenRoute={openRoute} /> : undefined} />
        <div className="browser-navigation-body" role="tabpanel" aria-label={tab}>
          <BrowserSessionsPane hidden={tab !== 'sessions'} sections={navigation.sections}><BrowserSidebarNavigation onNavigate={openRoute} settings={tab === 'sessions' ? <BrowserNavigationSettings navigation={navigation} onOpenRoute={openRoute} row /> : null}><BrowserSessionsSurface /></BrowserSidebarNavigation></BrowserSessionsPane>
          <div hidden={tab !== 'bots'} className="browser-pane"><BrowserBotsSurface fallback={<BrowserBotsFallback />} /></div>
        </div>
        {updateNotice && !updateDismissed && <div className="browser-update-panel" role="status" aria-label="Application update">
          <div className="browser-update-panel-heading"><strong>Update available</strong><button type="button" aria-label="Dismiss update" onClick={() => setUpdateDismissed(true)}>×</button></div>
          <p>{updateNotice.message}</p>
          <button type="button" className="browser-update-panel-action" onClick={updateNotice.update}>Update when safe</button>
        </div>}
        {!presentationMode && <BrowserProfileNavigation hidden={tab !== 'sessions'} />}
      </aside>
      <BrowserNavigationResizer navigation={navigation} />
      <main className="browser-main" ref={main} hidden={navigation.mobile && navigation.drawerOpen} inert={navigation.compact && !navigation.mobile && navigation.drawerOpen} tabIndex={-1} aria-label="Conversation and workspace">
        <div className="browser-chat-toolbar" aria-label="Chat toolbar">
          <BrowserToolbarButton tooltip={navigation.mobile ? 'Back to chat history' : navigation.open ? 'Hide sidebar' : 'Show sidebar'} className="browser-menu" ref={menu} aria-label={navigation.mobile ? 'Back to chat history' : navigation.open ? 'Hide navigation' : 'Open navigation'} aria-expanded={navigation.mobile ? undefined : navigation.open} aria-controls="browser-navigation" onClick={navigation.mobile ? navigation.backToHistory : navigation.toggle}>
            <Codicon name={navigation.mobile ? 'arrow-left' : 'layout-sidebar-left'} />
          </BrowserToolbarButton>
          <div className="browser-actions">
            <BrowserChatActionsMenu actions={sessionActions} title={chatTitle} panels={panels} main={main} />
          </div>
        </div>
        <BrowserConversationSurface />
        <div className="browser-status"><BrowserStatusSurface /></div>
      </main>
      <BrowserToolModal />
    </div>
  </div>
}
