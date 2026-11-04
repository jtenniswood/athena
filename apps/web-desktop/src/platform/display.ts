import type {} from '../upstream/types'
import { browserPreference } from './preferences'

const ZOOM_FACTOR_BASE = 1.2
const TOUCH_QUERY = '(pointer: coarse)'
const MOBILE_WIDTH_QUERY = '(max-width: 64rem)'
const DESKTOP_DEFAULT_ZOOM_LEVEL = Math.log(1.25) / Math.log(ZOOM_FACTOR_BASE)
const MOBILE_DEFAULT_ZOOM_LEVEL = Math.log(1.25) / Math.log(ZOOM_FACTOR_BASE)
const MIN_ZOOM_LEVEL = -9
const MAX_ZOOM_LEVEL = 9
const ZOOM_STEP = 0.1

type WebZoomChange = { level: number; percent: number }

function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) {
    return defaultZoomLevel()
  }

  return Math.min(Math.max(level, MIN_ZOOM_LEVEL), MAX_ZOOM_LEVEL)
}

function isMobileDevice(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia(TOUCH_QUERY).matches &&
    window.matchMedia(MOBILE_WIDTH_QUERY).matches
}

function defaultZoomLevel(): number {
  return isMobileDevice() ? MOBILE_DEFAULT_ZOOM_LEVEL : DESKTOP_DEFAULT_ZOOM_LEVEL
}

function zoomPreference() { return browserPreference(isMobileDevice() ? 'mobileScale' : 'desktopScale') }

function percentToZoomLevel(percent: number): number {
  if (!Number.isFinite(percent) || percent <= 0) {
    return defaultZoomLevel()
  }

  return clampZoomLevel(Math.log(percent / 100) / Math.log(ZOOM_FACTOR_BASE))
}

function zoomLevelToPercent(level: number): number {
  return Math.round(Math.pow(ZOOM_FACTOR_BASE, clampZoomLevel(level)) * 100)
}

function readStoredZoomPercent(): number { return zoomPreference().read() }

function isEditableZoomTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName))
}

/** Browser equivalent of Electron's global window zoom bridge. */
export function createWebZoomBridge(): NonNullable<Window['hermesDesktop']['zoom']> {
  let level = percentToZoomLevel(readStoredZoomPercent())
  let persisting = false
  const listeners = new Set<(change: WebZoomChange) => void>()

  const current = (): WebZoomChange => ({ level, percent: zoomLevelToPercent(level) })

  const apply = (nextLevel: number, persist: boolean): void => {
    level = clampZoomLevel(nextLevel)
    const change = current()

    // CSS zoom is supported by the Chromium browsers used by the web app and
    // scales layout, text, controls, and icons together like Electron's
    // webContents.setZoomLevel(). Apply it before the renderer mounts to avoid
    // a visible jump on startup.
    const scale = String(change.percent / 100)
    document.documentElement.style.setProperty('--web-ui-scale', scale)
    document.documentElement.style.setProperty('zoom', scale)

    if (persist) {
      persisting = true
      try { zoomPreference().write(change.percent) }
      finally { persisting = false }
    }

    for (const listener of listeners) {
      listener(change)
    }
  }

  // Preference writes from another control/tab and responsive mode changes
  // must update the same bridge and CSS projection. Ignore our own write's echo
  // so shortcut levels retain their precision and emit one change per action.
  const refresh = () => {
    if (persisting) return
    const next = percentToZoomLevel(readStoredZoomPercent())
    if (zoomLevelToPercent(next) !== current().percent) apply(next, false)
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || isEditableZoomTarget(event.target)) {
      return
    }

    const key = event.key
    if (key === '0') {
      event.preventDefault()
      apply(defaultZoomLevel(), true)
    } else if (key === '+' || key === '=' || event.code === 'Equal') {
      event.preventDefault()
      apply(level + ZOOM_STEP, true)
    } else if (key === '-' || key === '_' || event.code === 'Minus') {
      event.preventDefault()
      apply(level - ZOOM_STEP, true)
    } else {
      return
    }

    event.stopPropagation()
  }

  // Capture the shortcut before the renderer can treat it as a composer or
  // browser-page command. Inputs and text editors are intentionally excluded.
  window.addEventListener('keydown', onKeyDown, true)
  apply(level, false)
  // The installed bridge and these subscriptions share the window lifetime.
  browserPreference('desktopScale').subscribe(refresh)
  browserPreference('mobileScale').subscribe(refresh)
  window.matchMedia(TOUCH_QUERY).addEventListener('change', refresh)
  window.matchMedia(MOBILE_WIDTH_QUERY).addEventListener('change', refresh)

  return {
    get: async () => current(),
    factor: () => current().percent / 100,
    setPercent: (percent: number) => apply(percentToZoomLevel(percent), true),
    onChanged: (callback: (change: WebZoomChange) => void) => {
      listeners.add(callback)

      return () => listeners.delete(callback)
    }
  }
}
