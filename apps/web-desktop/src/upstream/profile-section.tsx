import { useStore } from '@nanostores/react'
import { $sidebarGrouping } from '@/store/layout'
import { useBrowserProfiles } from './profiles'
import { avatarColor, BotFace } from './browser-api'

/** Reuse the profile's configured picture and display name in session headers. */
export function useBrowserProfileSection(profile: string | undefined) {
  const model = useBrowserProfiles()
  const enabled = useStore($sidebarGrouping) === 'profile'
  if (!enabled || !profile) return null
  const item = model.items.find(item => item.key === profile) ?? (model.fallback?.key === profile ? model.fallback : null)
  const name = item?.botName ?? profile
  return {
    label: item?.label ?? profile,
    picture: <span data-browser-profile-picture={profile} className="inline-flex shrink-0 overflow-hidden rounded-full"><BotFace
      color={avatarColor(item?.appearance.color ?? null, name)}
      image={item?.appearance.image}
      name={name}
      shape={item?.appearance.shape ?? 'squircle'}
      size={24}
    /></span>
  }
}
