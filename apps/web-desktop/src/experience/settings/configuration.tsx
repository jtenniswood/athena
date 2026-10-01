import { settingsPageLabel } from './policy'
import { useId } from 'react'
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

export function BrowserConfigurationPage({ commands, scopeProfile }: { commands: BrowserConfigurationCommands; scopeProfile?: string }) {
  const showAuxiliaryTranscriptContent = useShowAuxiliaryTranscriptContent()
  return <section className="browser-configuration-page" aria-label="Configuration management">
    <h2>{settingsPageLabel('config:browser-configuration', 'Configuration')}</h2>
    <p>Manage the connected Hermes server’s configuration for this profile. This export is a configuration file, not a full server backup.</p>
    <p className="browser-settings-page-notice" role="note">Applies to profile: <strong>{scopeProfile || 'Active profile'}</strong></p>
    <section className="browser-transcript-setting" aria-labelledby="browser-transcript-setting-title">
      <h3 id="browser-transcript-setting-title">Conversation content</h3>
      <p>Choose whether to show thoughts, tool calls, timestamps, and activity notices alongside messages and replies.</p>
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
