import { useSyncExternalStore } from 'react'

const KEY = 'hermes-web.browser.show-auxiliary-transcript-content'
const CHANGE_EVENT = 'hermes-web:transcript-preferences-change'

export function readShowAuxiliaryTranscriptContent(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== 'false'
  } catch {
    return true
  }
}

export function writeShowAuxiliaryTranscriptContent(show: boolean): void {
  try {
    window.localStorage.setItem(KEY, String(show))
  } catch {
    // The setting remains usable in this tab when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

export function useShowAuxiliaryTranscriptContent(): boolean {
  return useSyncExternalStore(subscribe, readShowAuxiliaryTranscriptContent, () => true)
}

/** Reflect the browser preference for the upstream transcript CSS. */
export function installTranscriptPreferences(): () => void {
  const sync = () => {
    document.body.toggleAttribute('data-hide-auxiliary-transcript-content', !readShowAuxiliaryTranscriptContent())
  }
  sync()
  window.addEventListener(CHANGE_EVENT, sync)
  window.addEventListener('storage', sync)
  return () => {
    window.removeEventListener(CHANGE_EVENT, sync)
    window.removeEventListener('storage', sync)
    document.body.removeAttribute('data-hide-auxiliary-transcript-content')
  }
}
