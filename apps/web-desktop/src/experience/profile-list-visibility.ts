import { browserPreference, useBrowserPreference } from '../platform/preferences'

export const useHiddenProfileGroups = () => useBrowserPreference('hiddenProfileGroups')

export function hideProfileGroup(profile: string) {
  const preference = browserPreference('hiddenProfileGroups')
  const hidden = preference.read()
  if (!hidden.includes(profile)) preference.write([...hidden, profile])
}

export function restoreProfileGroups() {
  browserPreference('hiddenProfileGroups').write([])
}
