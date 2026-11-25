import { $projectScope, ALL_PROJECTS, exitProjectScope } from '@/store/project-scope'
import { setHideThreadTimeline } from '@/store/thread-timeline'
import { $gatewayState } from '@/store/session'
import { monitorBrowserSession } from '../platform/session-recovery'

let initialized = false

export function initializeBrowserShell(): void {
  if (initialized) return
  initialized = true

  // The browser keeps sessions in the home Projects overview. Clear a saved
  // drill-in scope before the first render and refuse later scope changes too.
  const keepProjectsOverview = (): void => {
    if ($projectScope.get() !== ALL_PROJECTS) exitProjectScope()
  }
  keepProjectsOverview()
  $projectScope.listen(keepProjectsOverview)

  // The web UI does not expose this preference; keep timeline bars visible
  // even when a browser has a previously saved desktop value.
  setHideThreadTimeline(false)

  // The renderer owns cold connection recovery until a gateway has opened.
  // Keep monitoring once connected, including while the gateway reconnects.
  if ($gatewayState.get() === 'open') {
    monitorBrowserSession()
  } else {
    const stop = $gatewayState.listen(state => {
      if (state !== 'open') return
      stop()
      monitorBrowserSession()
    })
  }
  // startBrowserHost has already completed the engine registration boundary.
  // BrowserShell owns the single ContribWiring instance at render time.
}
