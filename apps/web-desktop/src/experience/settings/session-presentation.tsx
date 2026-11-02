import { browserPreference, useBrowserPreference } from '../../platform/preferences'

export function BrowserSessionPresentationSetting() {
  const presentationMode = useBrowserPreference('presentationMode')
  return <section className="browser-followup-setting" aria-labelledby="browser-presentation-title">
    <h3 id="browser-presentation-title">Session list presentation</h3>
    <p>Presentation mode combines all profiles into sections with profile pictures and hides the bottom profile selector.</p>
    <div className="browser-followup-options" role="group" aria-label="Session list presentation">
      {([false, true] as const).map(enabled => <button
        key={String(enabled)}
        type="button"
        aria-pressed={presentationMode === enabled}
        className={presentationMode === enabled ? 'is-selected' : ''}
        onClick={() => browserPreference('presentationMode').write(enabled)}
      >{enabled ? 'Presentation' : 'Standard'}</button>)}
    </div>
  </section>
}
