import { useStore } from '@nanostores/react'
import { $pluginRecords, setPluginEnabled } from '@/contrib/plugins-store'

const BOTS_PLUGIN_ID = 'hermes-bots'

export type BrowserBotsPluginStatus = 'loading' | 'disabled' | 'error' | 'loaded'

/** Keep plugin inventory and lifecycle controls behind the renderer adapter. */
export function useBrowserBotsPlugin(): {
  status: BrowserBotsPluginStatus
  error?: string
  retry(): Promise<void>
} {
  const plugin = useStore($pluginRecords)[BOTS_PLUGIN_ID]
  const status = plugin?.status ?? 'loading'
  return {
    status,
    error: plugin?.error,
    async retry() {
      if (status !== 'disabled') await setPluginEnabled(BOTS_PLUGIN_ID, false)
      await setPluginEnabled(BOTS_PLUGIN_ID, true)
    }
  }
}
