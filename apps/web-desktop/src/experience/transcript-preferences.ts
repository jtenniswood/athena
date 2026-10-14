import { browserPreference, useBrowserPreference } from '../platform/preferences'

export const readShowAuxiliaryTranscriptContent = (): boolean => browserPreference('auxiliaryTranscript').read()
export const writeShowAuxiliaryTranscriptContent = (show: boolean): void => browserPreference('auxiliaryTranscript').write(show)
export const useShowAuxiliaryTranscriptContent = (): boolean => useBrowserPreference('auxiliaryTranscript')

/** Reflect the browser preference for the upstream transcript CSS. */
export function installTranscriptPreferences(): () => void {
  const store = browserPreference('auxiliaryTranscript')
  const sync = () => document.body.toggleAttribute('data-hide-auxiliary-transcript-content', !store.read())
  sync()
  const unsubscribe = store.subscribe(sync)
  return () => { unsubscribe(); document.body.removeAttribute('data-hide-auxiliary-transcript-content') }
}
