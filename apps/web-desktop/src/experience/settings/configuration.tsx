import { settingsPageLabel } from './policy'
import { useId } from 'react'
import { announceSettingsReset } from '../../upstream/settings-interactions'
import { useFollowupBehavior, writeFollowupBehavior } from '../followup-preferences'
import { useShowAuxiliaryTranscriptContent, writeShowAuxiliaryTranscriptContent } from '../transcript-preferences'

export type BrowserConfigurationCommand = {
  description: string
  label: string
  run: () => void | Promise<void>
}

export type BrowserConfigurationCommands = {
  export: BrowserConfigurationCommand
  import: BrowserConfigurationCommand
  reset: BrowserConfigurationCommand
}

export function createBrowserConfigurationCommands(
  labels: { export: string; import: string; reset: string },
  commands: { export: () => void | Promise<void>; import: () => void; reset: () => void | Promise<void> }
): BrowserConfigurationCommands {
  return {
    export: { label: labels.export, description: 'Download this profile’s configuration as a JSON file.', run: commands.export },
    import: { label: labels.import, description: 'Restore this profile’s configuration from a JSON file.', run: commands.import },
    reset: { label: labels.reset, description: 'Restore this profile’s configuration defaults, including hidden options. You will be asked to confirm.', run: () => { announceSettingsReset(); return commands.reset() } }
  }
}

/** Keep upstream action handlers and confirmation flows on labelled controls. */
export function BrowserConfigurationAction({ command }: { command: BrowserConfigurationCommand }) {
  const descriptionId = useId()
  return <button type="button" className="browser-configuration-action" aria-label={command.label} aria-describedby={descriptionId} onClick={() => void command.run()}>
    <span>
      <span className="browser-configuration-action-label">{command.label}</span>
      <span className="browser-configuration-action-description" id={descriptionId}>{command.description}</span>
    </span>
  </button>
}

export function BrowserConfigurationPage({ commands }: { commands: BrowserConfigurationCommands; scopeProfile?: string }) {
  const followupBehavior = useFollowupBehavior()
  const showAuxiliaryTranscriptContent = useShowAuxiliaryTranscriptContent()
  return <section className="browser-settings-page browser-configuration-page" aria-label="Configuration management">
    <h2 className="browser-settings-page-title">{settingsPageLabel('config:browser-configuration', 'Configuration')}</h2>
    <section className="browser-followup-setting" aria-labelledby="browser-followup-setting-title">
      <h3 id="browser-followup-setting-title">Follow-up behavior</h3>
      <p>Queue or steer messages sent during a reply. Cmd/Ctrl+Enter uses the other action once.</p>
      <div className="browser-followup-options" role="group" aria-label="Default follow-up behavior">
        {(['queue', 'steer'] as const).map(value => <button
          aria-pressed={followupBehavior === value}
          className={followupBehavior === value ? 'is-selected' : ''}
          key={value}
          onClick={() => writeFollowupBehavior(value)}
          type="button"
        >{value === 'queue' ? 'Queue' : 'Steer'}</button>)}
      </div>
    </section>
    <section className="browser-transcript-setting" aria-labelledby="browser-transcript-setting-title">
      <h3 id="browser-transcript-setting-title">Conversation content</h3>
      <p>Show thoughts, tool calls, timestamps, and activity notices in the chat.</p>
      <label className="browser-transcript-setting-toggle">
        <input
          checked={showAuxiliaryTranscriptContent}
          onChange={event => writeShowAuxiliaryTranscriptContent(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Show extra conversation content</span>
      </label>
    </section>
    <div className="browser-configuration-actions">
      <BrowserConfigurationAction command={commands.export} />
      <BrowserConfigurationAction command={commands.import} />
      <BrowserConfigurationAction command={commands.reset} />
    </div>
  </section>
}
