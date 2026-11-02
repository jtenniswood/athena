import { atom } from 'nanostores'
import { browserPreference } from './preferences'

// The preference is the sole owner; this projection lets renderer selectors
// react to settings, synced preferences and cross-tab changes immediately.
const preference = browserPreference('presentationMode')
export const $browserPresentationMode = atom(preference.read())
preference.subscribe(() => $browserPresentationMode.set(preference.read()))
