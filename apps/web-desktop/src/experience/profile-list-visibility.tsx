import { browserPreference, useBrowserPreference } from '../platform/preferences'
import { Codicon, DropdownMenuItem } from '../upstream/browser-api'

export const useHiddenProfileGroups = () => useBrowserPreference('hiddenProfileGroups')

export function BrowserHideProfileItem({ profile }: { profile: string }) {
  return <DropdownMenuItem onSelect={() => {
    const preference = browserPreference('hiddenProfileGroups')
    preference.write([...new Set([...preference.read(), profile])])
  }}>Hide profile</DropdownMenuItem>
}

export function BrowserRestoreProfilesItem() {
  const hidden = useHiddenProfileGroups()
  return <DropdownMenuItem disabled={hidden.length === 0} onSelect={() => browserPreference('hiddenProfileGroups').write([])}>
    <Codicon name="eye" size="0.8125rem" />Restore all profiles
  </DropdownMenuItem>
}
