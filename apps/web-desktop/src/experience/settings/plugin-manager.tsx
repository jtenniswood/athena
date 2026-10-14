import { useNavigate } from 'react-router'
import { useBrowserPluginManager } from '../../upstream/settings-plugin-manager'
import { Codicon } from '../../upstream/browser-api'

export function BrowserPluginManager() {
  const navigate = useNavigate()
  const manager = useBrowserPluginManager()

  return <section className="browser-settings-plugin-manager" aria-label="Manage plugins">
    {manager.scope}
    <button className="browser-settings-plugin-back" type="button" onClick={() => navigate('/settings?tab=plugins', { replace: true })}>
      <Codicon name="arrow-left" />
      <span>Back to plugin settings</span>
    </button>
    <div className="browser-settings-plugin-content">
      {manager.content}
    </div>
  </section>
}
