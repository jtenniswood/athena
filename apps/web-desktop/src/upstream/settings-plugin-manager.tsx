import { useStore } from '@nanostores/react'
import { PluginsTab } from '@/app/capabilities/plugins/plugins-tab'
import { SettingsProfileScope } from '@/app/settings/profile-scope'
import { $settingsRequestProfile, $settingsScopeProfile } from '@/store/settings-scope'

/** Read the renderer's current scope without giving browser composition raw stores. */
export function useBrowserPluginManager() {
  const profile = useStore($settingsRequestProfile)
  const label = useStore($settingsScopeProfile)
  return { scope: <SettingsProfileScope />,
    content: <PluginsTab key={profile ?? 'custom'} profile={profile} scopeLabel={label} /> }
}
