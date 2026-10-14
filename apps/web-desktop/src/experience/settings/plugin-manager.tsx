import { useStore } from '@nanostores/react'
import { useNavigate } from 'react-router'
import { PluginsTab } from '@/app/capabilities/plugins/plugins-tab'
import { SettingsProfileScope } from '@/app/settings/profile-scope'
import { $settingsRequestProfile, $settingsScopeProfile } from '@/store/settings-scope'
import { Codicon } from '../../upstream/browser-api'

export function BrowserPluginManager() {
  const navigate = useNavigate()
  const profile = useStore($settingsRequestProfile)
  const label = useStore($settingsScopeProfile)

  return <section className="browser-settings-plugin-manager" aria-label="Manage plugins">
    <SettingsProfileScope />
    <button className="browser-settings-plugin-back" type="button" onClick={() => navigate('/settings?tab=plugins', { replace: true })}>
      <Codicon name="arrow-left" />
      <span>Back to plugin settings</span>
    </button>
    <div className="browser-settings-plugin-content">
      <PluginsTab key={profile ?? 'custom'} profile={profile} scopeLabel={label} />
    </div>
  </section>
}
