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
