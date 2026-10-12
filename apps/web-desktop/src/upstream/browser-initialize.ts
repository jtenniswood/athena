// The browser shell uses the upstream contribution wiring, but it does not
// render the desktop controller. Importing the controller module still matters:
// its module-level setup registers panes, layout presets, bundled plugins,
// session routing, and the overlay bindings consumed by BrowserShell.
import '../../../desktop/src/app/contrib/controller'
import { $projectScope, ALL_PROJECTS, exitProjectScope } from '@/store/projects'
import { setHideThreadTimeline } from '@/store/thread-timeline'

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
  // Importing the upstream controller registers panes and layout presets.
  // BrowserShell owns the single ContribWiring instance at render time.
}
