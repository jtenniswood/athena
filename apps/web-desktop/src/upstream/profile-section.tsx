import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { browserPreference, useBrowserPreference } from '../platform/preferences'
import { $sidebarGrouping, setSidebarGrouping } from '@/store/layout'
import { $showAllProfiles, setShowAllProfiles } from '@/store/profile'
import { useBrowserProfiles } from './profiles'
import { avatarColor, BotFace } from './browser-api'

/** Profile layout and the grouping of conversations are independent preferences. */
export function useBrowserProfileGrouping(): boolean {
  const combined = useBrowserPreference('combinedProfiles')
  const legacy = useBrowserPreference('presentationMode')
  const all = useStore($showAllProfiles)
  useEffect(() => {
    if (combined && !all) setShowAllProfiles(true)
    if (legacy) {
      browserPreference('presentationMode').write(false)
    }
  }, [combined, legacy, all])
  return combined
}

export function setBrowserProfilesCombined(combined: boolean): void {
  const grouping = $sidebarGrouping.get()
  browserPreference('combinedProfiles').write(combined)
  // Scope changes browse the same conversation; selecting a profile would start a fresh chat.
  setShowAllProfiles(combined)
  setSidebarGrouping(grouping === 'profile' ? 'none' : grouping)
}

export function resetBrowserSidebarView(reset: () => void): void {
  reset()
  setBrowserProfilesCombined(true)
}

/** Reuse the profile's configured picture and display name in session headers. */
export function useBrowserProfileSection(profile: string | undefined) {
  const model = useBrowserProfiles()
  const enabled = useBrowserProfileGrouping()
  if (!enabled || !profile) return null
  const item = model.items.find(item => item.key === profile) ?? (model.fallback?.key === profile ? model.fallback : null)
  const name = item?.botName ?? profile
  return {
    label: item?.label ?? profile,
    picture: <span data-browser-profile-picture={profile} className="inline-flex shrink-0 overflow-hidden rounded-full"><BotFace
      color={avatarColor(item?.appearance.color ?? null, name)} image={item?.appearance.image} name={name}
      shape={item?.appearance.shape ?? 'squircle'} size={20}
    /></span>
  }
}
