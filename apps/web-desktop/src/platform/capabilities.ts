/** A capability is a support fact, not a user's visibility preference. */
export type CapabilityState = 'supported' | 'unsupported' | 'unknown'
export type CapabilitySource = 'browser' | 'hosting' | 'server'

export interface CapabilityObservation {
  id: string
  source: CapabilitySource
  state: CapabilityState
  evidence: string
}

export interface ResolvedCapability {
  id: string
  state: CapabilityState
  evidence: string
}

export interface BrowserEnvironment {
  clipboard: boolean
  notifications: boolean
  microphone: boolean
}

export interface BrowserCapabilities {
  nativeTerminal: false
  nativeGit: false
  desktopUpdater: false
  desktopOverlay: false
  secureTokenStorage: false
  fileAttachments: true
  clipboard: boolean
  notifications: boolean
  microphone: boolean
}

function currentBrowserEnvironment(): BrowserEnvironment {
  return {
    clipboard: typeof navigator !== 'undefined' && Boolean(navigator.clipboard),
    notifications: typeof window !== 'undefined' && ('Notification' in window || 'AthenaAndroid' in window),
    microphone: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  }
}

/** Browser facts describe API support. Permission can still be required at use time. */
export function browserCapabilities(environment = currentBrowserEnvironment()): BrowserCapabilities {
  return {
    nativeTerminal: false,
    nativeGit: false,
    desktopUpdater: false,
    desktopOverlay: false,
    secureTokenStorage: false,
    fileAttachments: true,
    clipboard: environment.clipboard,
    notifications: environment.notifications,
    microphone: environment.microphone
  }
}

/** Convert browser API availability into observations without implying permission. */
export function observeBrowserCapabilities(environment = currentBrowserEnvironment()): CapabilityObservation[] {
  const capabilities = browserCapabilities(environment)
  const fixed: [keyof BrowserCapabilities, string][] = [
    ['nativeTerminal', 'This app runs in a browser and has no native terminal.'],
    ['nativeGit', 'This app runs in a browser and has no native Git integration.'],
    ['desktopUpdater', 'Browser updates are delivered as app releases.'],
    ['desktopOverlay', 'This browser has no native desktop overlay.'],
    ['secureTokenStorage', 'Browser credentials use browser storage, not native secure storage.'],
    ['fileAttachments', 'The browser can attach files selected or dropped by the user.']
  ]
  const observations = fixed.map(([id, supported]) => ({
    id: `browser.${id}`,
    source: 'browser' as const,
    state: capabilities[id] ? 'supported' as const : 'unsupported' as const,
    evidence: supported
  }))
  observations.push(
    {
      id: 'browser.clipboard', source: 'browser',
      state: capabilities.clipboard ? 'supported' : 'unsupported',
      evidence: capabilities.clipboard
        ? 'The Clipboard API is available; access can still require permission and a secure context.'
        : 'The Clipboard API is unavailable in this browser context.'
    },
    {
      id: 'browser.notifications', source: 'browser',
      state: capabilities.notifications ? 'supported' : 'unsupported',
      evidence: capabilities.notifications
        ? 'The Notifications API is available; notifications still require user permission.'
        : 'The Notifications API is unavailable in this browser context.'
    },
    {
      id: 'browser.microphone', source: 'browser',
      state: capabilities.microphone ? 'supported' : 'unsupported',
      evidence: capabilities.microphone
        ? 'Microphone capture is available; recording still requires a secure context and user permission.'
        : 'Microphone capture is unavailable in this browser context.'
    }
  )
  return observations
}

/** Hosting facts come from runtime configuration; absent values stay unknown. */
export function observeHostingCapabilities(capabilities?: {
  gatewaySelection?: boolean
  pluginAssets?: boolean
}): CapabilityObservation[] {
  const observe = (id: string, value: boolean | undefined, enabled: string, disabled: string): CapabilityObservation => ({
    id: `hosting.${id}`,
    source: 'hosting',
    state: value === true ? 'supported' : value === false ? 'unsupported' : 'unknown',
    evidence: value === true ? enabled : value === false ? disabled : 'The hosting configuration does not report this capability.'
  })
  return [
    observe('gateway-selection', capabilities?.gatewaySelection, 'The host permits gateway selection.', 'The host fixes the app to one configured gateway.'),
    observe('plugin-assets', capabilities?.pluginAssets, 'The host serves installed Hermes plugin assets.', 'The host does not serve installed Hermes plugin assets.')
  ]
}

/** Server facts remain unknown until the connected Hermes server reports them. */
export function observeServerCapability(id: string): CapabilityObservation {
  return {
    id: `server.${id}`,
    source: 'server',
    state: 'unknown',
    evidence: 'The connected Hermes server does not advertise this capability.'
  }
}

export function observeRuntimeCapabilities(hosting?: {
  gatewaySelection?: boolean
  pluginAssets?: boolean
}): CapabilityObservation[] {
  return [
    ...observeBrowserCapabilities(),
    ...observeHostingCapabilities(hosting),
    observeServerCapability('real-browser-profile')
  ]
}
/** A capability requiring several layers is unsupported if any layer refuses it. */
export function resolveCapability(
  id: string,
  requiredSources: readonly CapabilitySource[],
  observations: readonly CapabilityObservation[]
): ResolvedCapability {
  const relevant = requiredSources.map(source => observations.find(item => item.id === id && item.source === source))
  const evidence = relevant.filter((item): item is CapabilityObservation => Boolean(item)).map(item => item.evidence)
  const state: CapabilityState = relevant.some(item => item?.state === 'unsupported')
    ? 'unsupported'
    : relevant.length > 0 && relevant.every(item => item?.state === 'supported')
      ? 'supported'
      : 'unknown'
  return { id, state, evidence: evidence.join(' ') || 'No capability evidence is available.' }
}
