import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { $pluginRecords, setPluginEnabled } from '@/contrib/plugins-store'

const BOTS_PLUGIN_ID = 'hermes-bots'

/** Explain a missing Bots pane and let users recover its bundled plugin. */
export function BrowserBotsFallback() {
  const plugins = useStore($pluginRecords)
  const plugin = plugins[BOTS_PLUGIN_ID]
  const [busy, setBusy] = useState(false)

  if (!plugin) return <p className="browser-empty">Loading Bots…</p>

  const disabled = plugin.status === 'disabled'
  const retry = async () => {
    if (busy) return
    setBusy(true)
    try {
      if (!disabled) await setPluginEnabled(BOTS_PLUGIN_ID, false)
      await setPluginEnabled(BOTS_PLUGIN_ID, true)
    } finally {
      setBusy(false)
    }
  }

  const message = disabled
    ? 'Bot Mode is disabled. Enable it to load Bots and their profile images.'
    : plugin.status === 'error'
      ? `Bot Mode could not start: ${plugin.error || 'unknown error'}`
      : 'The Bot Mode panel did not register. Retry it to reload Bots and profile images.'

  return <div className="browser-empty" role="status">
    <p>{message}</p>
    <button data-browser-toolbar-button type="button" disabled={busy} onClick={() => void retry()}>
      {busy ? 'Starting…' : disabled ? 'Enable Bots' : 'Retry Bots'}
    </button>
  </div>
}
