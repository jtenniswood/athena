import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { $pluginRecords, setPluginEnabled } from '@/contrib/plugins-store'
import { Button } from '@/components/ui/button'

export function BrowserKanbanSetup() {
  const plugin = useStore($pluginRecords).kanban
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)

  async function enable() {
    setBusy(true)
    setError(false)
    try {
      await setPluginEnabled('kanban', true)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const failed = error || plugin?.status === 'error' || plugin?.status === 'loaded'
  return <section className="flex flex-1 flex-col items-center justify-center gap-3 p-4 text-center" aria-label="Kanban setup">
    <h1 className="text-lg font-semibold">Kanban</h1>
    {!plugin ? <p role="status">Loading Kanban…</p> : <>
      <p role={failed ? 'alert' : undefined}>{failed ? 'Kanban could not start.' : 'Enable the Kanban plugin to open your Hermes task board.'}</p>
      <Button type="button" disabled={busy} onClick={() => void enable()}>
        {busy ? 'Starting…' : failed ? 'Retry Kanban' : 'Enable Kanban'}
      </Button>
    </>}
  </section>
}
