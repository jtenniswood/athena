import type { BrowserConversationModel } from '../experience/contracts/conversation'
import type { BrowserEngine } from '../experience/contracts/engine'
import { lazy, Suspense } from 'react'
import { BrowserEngineHost, BrowserSessionsSurface, BrowserBotsSurface, BrowserConversationSurface, BrowserStatusSurface, BrowserPageSurface, useBrowserHostPanels, openBrowserPage } from './browser-host'
import { useBrowserConversation } from './conversation'
import { useBrowserSessionActions } from './conversation-actions'
import { selectBrowserSession } from './selection'
import { BrowserProfileEditor } from './profile-editor'
import { useBrowserProfiles, useBrowserActiveProfile } from './profiles'
import { useBrowserProfileGrouping } from './profile-section'
import { browserRouteCoversWorkspace } from './browser-routes'
import { useBrowserGatewayRequest } from './gateway-request'
import { useBrowserApproval } from './approval'
import { browserDropProjectId, moveBrowserSessionToProject, reportBrowserProjectMoveFailure } from './project-actions'
import { useRendererMenuCompatibility } from './use-renderer-menu-compatibility'
import { useAndroidVisibleConversation } from './android-host'

const SettingsController = lazy(async () => ({ default: (await import('./settings-controller-api')).BrowserSettingsControllerSurface }))

/** The pinned renderer implements the product contract; its stores stay private to adapters. */
export const browserEngine = Object.freeze({
  protocol: 1,
  surfaces: {
    Host: BrowserEngineHost, Sessions: BrowserSessionsSurface, Bots: BrowserBotsSurface,
    Conversation: BrowserConversationSurface, Status: BrowserStatusSurface, Page: BrowserPageSurface,
    ProfileEditor: BrowserProfileEditor
  },
  conversations: { useCurrent: useBrowserConversation, useActions: useBrowserSessionActions, select: selectBrowserSession },
  profiles: { useProfiles: useBrowserProfiles, useActive: useBrowserActiveProfile, useGrouping: useBrowserProfileGrouping },
  navigation: { usePanels: useBrowserHostPanels, openPage: openBrowserPage, coversWorkspace: browserRouteCoversWorkspace },
  settings: { Controller: props => <Suspense fallback={<p role="status">Loading settings…</p>}><SettingsController {...props} /></Suspense> },
  approval: { useRequest: useBrowserGatewayRequest, useMode: useBrowserApproval },
  projects: { eligibleDrop: browserDropProjectId, move: moveBrowserSessionToProject, reportFailure: reportBrowserProjectMoveFailure },
  useEnvironment(conversation: BrowserConversationModel, visible: boolean) {
    useRendererMenuCompatibility()
    useAndroidVisibleConversation(conversation.status === 'ready' ? conversation.sessionId : null, visible)
  }
} satisfies BrowserEngine)
