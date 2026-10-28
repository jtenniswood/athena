import { isAndroidApp } from './platform/android'
import { buildInfo } from './build-info'
import { completeStartup, recoverStartupChunk, restoreStartupLocation, showStartupRecovery } from './platform/startup-recovery'
import { startBrowserApplication } from './startup'
import './web.css'
import './experience/styles/tokens.css'
import './experience/styles/controls.css'
import './experience/styles/menus.css'
import './web-overrides.css'
import './platform/sign-in.css'
import { installTimelineRailScrubbing } from './experience/ui/timeline-rail-scrubbing'
import { trackVisualViewport } from './platform/viewport'
import { installComposerKeyboard } from './platform/composer-keyboard'
import { installAndroidNavigationGuard } from './platform/android-navigation'

// The native bridge is injected before this entry point, including sign-in.
if (isAndroidApp()) document.documentElement.dataset.androidApp = 'true'

const stopTrackingViewport = trackVisualViewport()
if (import.meta.hot) import.meta.hot.dispose(stopTrackingViewport)
const stopTimelineRailScrubbing = installTimelineRailScrubbing()
if (import.meta.hot) import.meta.hot.dispose(stopTimelineRailScrubbing)
const stopComposerKeyboard = installComposerKeyboard()
if (import.meta.hot) import.meta.hot.dispose(stopComposerKeyboard)
const stopAndroidNavigationGuard = installAndroidNavigationGuard()
if (import.meta.hot) import.meta.hot.dispose(stopAndroidNavigationGuard)

async function start(): Promise<void> {
  try {
    restoreStartupLocation()
    await startBrowserApplication()
    completeStartup()
  } catch (error) {
    if (recoverStartupChunk(error, buildInfo.wrapperRevision)) return
    console.error('Athena startup failed', error)
    showStartupRecovery(error, buildInfo.wrapperRevision)
  }
}
void start()
