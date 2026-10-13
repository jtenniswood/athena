import { BrowserToolModal } from './tool-modal'
import { BrowserToolbarButton } from './ui/toolbar-button'
import { useRendererMenuCompatibility } from '../upstream/use-renderer-menu-compatibility'
import { BrowserNavigationTabs, BrowserNavigationResizer, useBrowserNavigation } from './navigation'
import { BrowserProfileNavigation } from './profile-navigation'
import { BrowserActionError } from './action-errors'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { BrowserSidebarNavigation } from './sidebar-extras'
import { BrowserSessionsPane } from './sidebar-sections'
import { BrowserBotsFallback } from './browser-bots-fallback'
import { installTranscriptPreferences } from './transcript-preferences'
import { Codicon, SidebarProvider } from '../upstream/browser-api'
import { BrowserEngineHost, BrowserSessionsSurface, BrowserBotsSurface, BrowserConversationSurface, BrowserStatusSurface, useBrowserHostPanels, openBrowserPage } from '../upstream/browser-host'
import { BrowserChatActionsMenu } from './chat-actions-menu'
import { useBrowserConversation } from '../upstream/conversation'
import { useBrowserSessionActions } from '../upstream/conversation-actions'
import { browserDropProjectId, moveBrowserSessionToProject, reportBrowserProjectMoveFailure } from '../upstream/project-actions'
import { currentPwaUpdate, subscribePwaUpdate, type PwaUpdateNotice } from '../pwa/register'
import { installConversationSubmitScroll } from './ui/submit-scroll'

interface SessionProjectDrag {
  pointerId: number
  sessionId: string
  profile: string
  startX: number
  startY: number
  active: boolean
  target: HTMLElement | null
  targetProjectId?: string
}

interface SessionReorderDrag {
  pointerId: number
  sourceId: string
  startX: number
  startY: number
  active: boolean
  target: HTMLElement | null
}

export function BrowserShell() {
  return <SidebarProvider className="browser-provider" style={{ '--sidebar-width': '100%' } as CSSProperties}>
    <BrowserEngineHost><BrowserLayout /></BrowserEngineHost>
  </SidebarProvider>
}
function BrowserLayout() {
  useRendererMenuCompatibility()
  useEffect(() => installConversationSubmitScroll(), [])
  useEffect(() => installTranscriptPreferences(), [])
  const sessionProjectDrag = useRef<SessionProjectDrag | null>(null)
  const sessionReorderDrag = useRef<SessionReorderDrag | null>(null)
  useEffect(() => {
    const clearTarget = (drag: SessionProjectDrag) => {
      drag.target?.removeAttribute('data-session-drop-active')
      drag.target = null
    }
    const clearReorderTarget = (drag: SessionReorderDrag) => {
      drag.target?.removeAttribute('data-session-order-drop')
      drag.target = null
    }
    const finish = (event: PointerEvent, commit: boolean) => {
      const reorder = sessionReorderDrag.current
      if (reorder?.pointerId === event.pointerId) {
        clearReorderTarget(reorder)
        sessionReorderDrag.current = null
      }
      const drag = sessionProjectDrag.current
      if (!drag || drag.pointerId !== event.pointerId) return
      sessionProjectDrag.current = null
      clearTarget(drag)
      if (!commit || !drag.active || !drag.targetProjectId) return
      void moveBrowserSessionToProject(drag.sessionId, drag.targetProjectId, drag.profile)
        .catch(reportBrowserProjectMoveFailure)
    }
    const onPointerMove = (event: PointerEvent) => {
      const reorder = sessionReorderDrag.current
      if (reorder?.pointerId === event.pointerId) {
        if (!reorder.active && Math.hypot(event.clientX - reorder.startX, event.clientY - reorder.startY) >= 6) {
          reorder.active = true
        }
        if (reorder.active) {
          const element = document.elementFromPoint(event.clientX, event.clientY)
          const candidate = element instanceof Element ? element.closest<HTMLElement>('[data-web-session-id]') : null
          if (!candidate || candidate.dataset.webSessionId === reorder.sourceId) {
            clearReorderTarget(reorder)
          } else if (candidate !== reorder.target) {
            clearReorderTarget(reorder)
            const rect = candidate.getBoundingClientRect()
            candidate.dataset.sessionOrderDrop = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
            reorder.target = candidate
          } else {
            const rect = candidate.getBoundingClientRect()
            candidate.dataset.sessionOrderDrop = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
          }
        }
      }

      const drag = sessionProjectDrag.current
      if (!drag || drag.pointerId !== event.pointerId) return
      if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return
      drag.active = true
      event.preventDefault()
      const element = document.elementFromPoint(event.clientX, event.clientY)
      const candidate = element instanceof Element ? element.closest<HTMLElement>('[data-sessions-project]') : null
      const projectId = candidate?.dataset.sessionsProject
      const nextTargetProjectId = browserDropProjectId(projectId)
      const nextTarget = nextTargetProjectId ? candidate : null
      if (nextTarget === drag.target) return
      clearTarget(drag)
      drag.target = nextTarget
      if (nextTarget) nextTarget.setAttribute('data-session-drop-active', '')
      drag.targetProjectId = nextTarget ? nextTargetProjectId! : undefined
    }
    const onPointerUp = (event: PointerEvent) => finish(event, true)
    const onPointerCancel = (event: PointerEvent) => finish(event, false)
    window.addEventListener('pointermove', onPointerMove, { passive: false })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    return () => {
      const drag = sessionProjectDrag.current
      if (drag) clearTarget(drag)
      const reorder = sessionReorderDrag.current
      if (reorder) clearReorderTarget(reorder)
      sessionProjectDrag.current = null
      sessionReorderDrag.current = null
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [])
  const preventSessionPaneDrag = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const reorderHandle = target.closest('[data-reorder-handle]')
    if (reorderHandle && event.button === 0) {
      const row = reorderHandle.closest<HTMLElement>('[data-web-session-id]')
      if (row) {
        sessionReorderDrag.current = {
          pointerId: event.pointerId,
          sourceId: row.dataset.webSessionId!,
          startX: event.clientX,
          startY: event.clientY,
          active: false,
          target: null
        }
      }
      return
    }
    const row = target.closest<HTMLElement>('[data-web-session-id]')
    if (!row || target.closest('[data-reorder-handle], [data-row-actions]')) return

    // Sidebar session drags can reorder sessions or move them into a project.
    // Stop the desktop pane-drop gesture, which is unsupported in this shell.
    event.stopPropagation()
    if (event.button !== 0) return
    sessionProjectDrag.current = {
      pointerId: event.pointerId,
      sessionId: row.dataset.webSessionId!,
      profile: row.dataset.webSessionProfile || 'default',
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      target: null,
      targetProjectId: undefined
    }
  }
  const navigate = useNavigate(), location = useLocation()
  const conversation = useBrowserConversation()
  const sessionActions = useBrowserSessionActions()
  const chatTitle = conversation.displayName || ''
  const panels = useBrowserHostPanels()
  const main = useRef<HTMLElement>(null), menu = useRef<HTMLButtonElement>(null)
  const navigation = useBrowserNavigation({ selectionKey: conversation.selectionKey, path: location.pathname, main, trigger: menu })
  const { tab } = navigation
  const [updateNotice, setUpdateNotice] = useState<PwaUpdateNotice | null>(() => currentPwaUpdate())
  const [updateDismissed, setUpdateDismissed] = useState(false)
  useEffect(() => subscribePwaUpdate(notice => {
    setUpdateNotice(notice)
    if (notice) setUpdateDismissed(false)
  }), [])
  const openRoute = (path: string) => {
    openBrowserPage(navigate, path)
    navigation.closeDrawer()
  }
  return <div className="browser-shell" data-browser-shell="" data-browser-conversation-kind={conversation.kind} data-browser-conversation-id={conversation.id || undefined}>
    <BrowserActionError />
    <div className="browser-workspace">
      {navigation.compact && !navigation.mobile && navigation.drawerOpen && <button type="button" className="browser-scrim" aria-label="Dismiss navigation" tabIndex={-1} onClick={navigation.dismissDrawer} />}
      <aside id="browser-navigation" ref={navigation.drawer} onPointerDownCapture={preventSessionPaneDrag} hidden={!navigation.open} className={`browser-navigation ${navigation.drawerOpen ? 'is-open' : ''}`} role={navigation.compact && navigation.drawerOpen ? 'dialog' : undefined} aria-modal={navigation.compact && navigation.drawerOpen ? true : undefined} aria-label="Navigation" style={{ '--browser-navigation-width': `${navigation.width}px` } as CSSProperties}>
        <BrowserNavigationTabs navigation={navigation} settingsMenu={{ onOpenRoute: openRoute }} />
        <div className="browser-navigation-body" role="tabpanel" aria-label={tab}>
          <BrowserSessionsPane hidden={tab !== 'sessions'} sections={navigation.sections}><BrowserSidebarNavigation onNavigate={openRoute}><BrowserSessionsSurface /></BrowserSidebarNavigation></BrowserSessionsPane>
          <div hidden={tab !== 'bots'} className="browser-pane"><BrowserBotsSurface fallback={<BrowserBotsFallback />} /></div>
        </div>
        {updateNotice && !updateDismissed && <div className="browser-update-panel" role="status" aria-label="Application update">
          <div className="browser-update-panel-heading"><strong>Update available</strong><button type="button" aria-label="Dismiss update" onClick={() => setUpdateDismissed(true)}>×</button></div>
          <p>{updateNotice.message}</p>
          <button type="button" className="browser-update-panel-action" onClick={updateNotice.update}>Update when safe</button>
        </div>}
        <BrowserProfileNavigation hidden={tab !== 'sessions'} />
      </aside>
      <BrowserNavigationResizer navigation={navigation} />
      <main className="browser-main" ref={main} hidden={navigation.mobile && navigation.drawerOpen} inert={navigation.compact && !navigation.mobile && navigation.drawerOpen} tabIndex={-1} aria-label="Conversation and workspace">
        <div className="browser-chat-toolbar" aria-label="Chat toolbar">
          <BrowserToolbarButton tooltip={navigation.open ? 'Hide sidebar' : 'Show sidebar'} className="browser-menu" ref={menu} aria-label={navigation.open ? 'Hide navigation' : 'Open navigation'} aria-expanded={navigation.open} aria-controls="browser-navigation" onClick={navigation.toggle}>
            <Codicon name="layout-sidebar-left" />
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
