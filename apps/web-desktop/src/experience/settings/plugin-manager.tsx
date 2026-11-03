import { useNavigate } from 'react-router'
import { useBrowserPluginManager } from '../../upstream/settings-plugin-manager'
import { Codicon } from '../../upstream/browser-api'
import { useSettingsPresentation } from './presentation'

export function BrowserPluginManager() {
  const navigate = useNavigate()
  const manager = useBrowserPluginManager()
  const back = () => navigate('/settings?tab=plugins', { replace: true })
  const presentation = useSettingsPresentation<HTMLButtonElement>([{ id: 'back', kind: 'action',
    presentation: 'navigation', label: 'Back to plugin settings', run: back }])

  return <section className="browser-settings-plugin-manager" aria-label="Manage plugins">
    {manager.scope}
    <button ref={presentation} className="browser-settings-plugin-back" type="button" onClick={back}>
      <Codicon name="arrow-left" />
      <span>Back to plugin settings</span>
    </button>
    <div className="browser-settings-plugin-content">
      {manager.content}
    </div>
  </section>
}
