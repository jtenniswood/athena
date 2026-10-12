import { useState } from 'react'
import { useBrowserBotsPlugin } from '../upstream/browser-bots-plugin'

/** Explain a missing Bots pane and let users recover its bundled plugin. */
export function BrowserBotsFallback() {
  const { status, error, retry: retryPlugin } = useBrowserBotsPlugin()
  const [busy, setBusy] = useState(false)

  if (status === 'loading') return <p className="browser-empty">Loading Bots…</p>

  const disabled = status === 'disabled'
  const retry = async () => {
    if (busy) return
    setBusy(true)
    try { await retryPlugin() } finally { setBusy(false) }
  }

  const message = disabled
    ? 'Bot Mode is disabled. Enable it to load Bots and their profile images.'
    : status === 'error'
      ? `Bot Mode could not start: ${error || 'unknown error'}`
      : 'The Bot Mode panel did not register. Retry it to reload Bots and profile images.'

  return <div className="browser-empty" role="status">
    <p>{message}</p>
    <button data-browser-toolbar-button type="button" disabled={busy} onClick={() => void retry()}>
      {busy ? 'Starting…' : disabled ? 'Enable Bots' : 'Retry Bots'}
    </button>
  </div>
}
