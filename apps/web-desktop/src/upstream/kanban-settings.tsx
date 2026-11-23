import { useState } from 'react'
import { useStore } from '@nanostores/react'
import { SettingsContent, ToggleRow } from '@/app/settings/primitives'
import { $pluginRecords, setPluginEnabled } from '@/contrib/plugins-store'
import { $lanesByProfile, useKanbanScope } from '@/plugins/kanban/api'
import { BoardSwitcher } from '@/plugins/kanban/board-switcher'
import { OrchestrationPanel } from '@/plugins/kanban/orchestration'

export function BrowserKanbanSettings() {
  const plugin = useStore($pluginRecords).kanban
  const groupByProfile = useStore($lanesByProfile)
  const scope = useKanbanScope()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const enabled = plugin?.status === 'loaded'

  async function setEnabled(next: boolean) {
    setBusy(true)
    setFailed(false)
    try {
      await setPluginEnabled('kanban', next)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return <SettingsContent>
    <ToggleRow
      checked={enabled}
      disabled={!plugin || busy}
      label="Enable Kanban"
      description="Show the Kanban task board in Athena."
      onChange={next => void setEnabled(next)}
    />
    {(failed || plugin?.status === 'error') && <p role="alert">Kanban could not be updated. Try again.</p>}
    {enabled && <>
      <ToggleRow
        checked={groupByProfile}
        label="Group Running by profile"
        description="Group cards in the Running column by their assigned profile."
        onChange={next => $lanesByProfile.set(next)}
      />
      <section className="mt-5">
        <h3 className="mb-2 text-sm font-semibold">Boards</h3>
        <BoardSwitcher key={scope} />
      </section>
      <section className="mt-5" aria-label="Orchestration settings">
        <h3 className="mb-2 text-sm font-semibold">Orchestration</h3>
        <OrchestrationPanel key={scope} />
      </section>
    </>}
  </SettingsContent>
}
