import { Codicon } from '../../upstream/browser-api'
import { useBrowserBackendUpdates } from '../../upstream/backend-updates'
import { Button, CopyButton, SettingsContent } from '../../upstream/ui'
import { useState } from 'react'
import { writeClipboard } from '../../platform/clipboard'
import { useSettingsPresentation } from './presentation'

export function BrowserSystemUpdatesPage() {
  const { status, checking, apply, version, check, install } = useBrowserBackendUpdates()
  const [showLog, setShowLog] = useState(false)
  const updating = apply.applying || apply.stage === 'restart'
  const failed = apply.stage === 'error'
  const manual = apply.stage === 'manual'
  const available = Boolean(status?.updateAvailable || (status?.behind ?? 0) > 0)
  const busy = checking || updating
  const canInstall = status?.supported && !status.error && (available || failed) && !manual
  const title = updating ? 'Updating Hermes Agent…'
    : failed ? 'Update failed'
    : manual ? 'Manual update required'
    : checking || !status ? 'Checking for updates…'
    : status.error ? 'Could not check for updates'
    : !status.supported ? 'Automatic updates are unavailable'
    : available ? 'An update is available'
    : 'Hermes Agent is up to date'
  const description = updating || failed || manual ? apply.message
    : status?.error ? status.message || 'Check your server connection and try again.'
    : status && !status.supported ? status.message || 'Contact your server operator to update Hermes Agent.'
    : available ? 'Install the latest changes on your connected server.'
    : 'Check for updates to keep your connected server current.'
  const checkLabel = checking ? 'Checking…' : 'Check for updates'
  const installLabel = failed ? 'Retry update' : 'Update Hermes Agent'
  const presentation = useSettingsPresentation([
    { kind: 'text', label: `Installed version: ${version || 'Unavailable'}` },
    { kind: 'heading', label: title },
    ...(description ? [{ kind: 'text' as const, label: description }] : []),
    ...(manual && apply.command ? [{ kind: 'text' as const, label: apply.command },
      { id: 'copy', kind: 'action' as const, label: 'Copy update command', run: async () => { await writeClipboard(apply.command!) } }] : []),
    ...(updating && apply.percent !== null ? [{ kind: 'text' as const, label: `Update progress: ${apply.percent}%` }] : []),
    { id: 'check', kind: 'action', label: checkLabel, disabled: busy, run: check },
    ...(canInstall ? [{ id: 'install', kind: 'action' as const, presentation: 'primary' as const, label: installLabel, disabled: busy, run: install }] : []),
    ...(apply.log.length ? [{ id: 'log', kind: 'action' as const, label: 'Update activity', run: () => setShowLog(!showLog) },
      ...((showLog || failed) ? apply.log.map(entry => ({ kind: 'text' as const, label: entry.message })) : [])] : []),
    ...(!updating && available && status?.commits?.length ? [{ kind: 'heading' as const, label: 'Available changes' },
      ...status.commits.map(commit => ({ kind: 'text' as const, label: commit.summary }))] : [])
  ])

  return <SettingsContent>
    <section ref={presentation} className="browser-settings-page browser-updates-page" aria-label="System updates">
      <header className="browser-settings-page-header">
        <h2 className="browser-settings-page-title">System updates</h2>
        <p className="browser-settings-page-description">Check for Hermes Agent updates.</p>
      </header>
      <div className="browser-updates-version">
        <span>Installed version</span>
        <span>{version || 'Unavailable'}</span>
      </div>
      <div className="browser-updates-status" role={failed || status?.error ? 'alert' : 'status'} aria-live="polite" aria-busy={busy}>
        <Codicon aria-hidden name={updating || checking ? 'sync' : failed || status?.error ? 'error' : available ? 'cloud-download' : manual || !status?.supported ? 'info' : 'check'} />
        <div><h3>{title}</h3><p>{description}</p></div>
      </div>
      {manual && apply.command && <div className="browser-updates-command">
        <code>{apply.command}</code>
        <CopyButton appearance="icon" label="Copy update command" text={apply.command} />
      </div>}
      {updating && apply.percent !== null && <progress aria-label="Update progress" max={100} value={apply.percent} />}
      <div className="browser-updates-actions">
        <Button variant="outline" disabled={busy} onClick={() => void check()}>{checkLabel}</Button>
        {canInstall && <Button disabled={busy} onClick={() => void install()}>{installLabel}</Button>}
      </div>
      {apply.log.length > 0 && <details className="browser-updates-log" open={showLog || failed} onToggle={event => setShowLog(event.currentTarget.open)}>
        <summary>Update activity</summary>
        <pre>{apply.log.map(entry => entry.message).join('\n')}</pre>
      </details>}
      {!updating && available && Boolean(status?.commits?.length) && <section className="browser-updates-changes" aria-label="Available changes">
        <h3>Available changes</h3>
        <ul>{status?.commits?.map(commit => <li key={commit.sha}>{commit.summary}</li>)}</ul>
      </section>}
    </section>
  </SettingsContent>
}
