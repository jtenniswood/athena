import { useLayoutEffect } from 'react'
import { atom } from 'nanostores'
import { useStore } from '@nanostores/react'
import type { useBrowserNavigation } from '../navigation'
import type { BrowserActionGroup } from '../ui/action-surface'
import { useSettingsPresentation } from './presentation'

// Settings overlays are siblings of the shell, so publish its live commands.
const $chatPanelSettings = atom<BrowserActionGroup[]>([])

export function useChatPanelSettings(navigation: ReturnType<typeof useBrowserNavigation>) {
  useLayoutEffect(() => { $chatPanelSettings.set(chatPanelSettingsGroups(navigation)) })
  useLayoutEffect(() => () => { $chatPanelSettings.set([]) }, [])
}

/** Reuse the live navigation commands and their existing preference owners. */
function chatPanelSettingsGroups(navigation: ReturnType<typeof useBrowserNavigation>): BrowserActionGroup[] {
  return [{ key: 'sections', label: 'Sections', actions: navigation.sections.actions }]
}

export function BrowserChatPanelPage() {
  const groups = useStore($chatPanelSettings)
  const presentation = useSettingsPresentation<HTMLDivElement>([
    ...groups.flatMap(group => [
      { kind: 'heading' as const, label: group.label || group.key },
      ...group.actions.map(action => ({ id: `${group.key}:${action.key}`, kind: 'toggle' as const,
        label: action.label, checked: action.checked, disabled: action.disabled, run: action.run }))
    ])
  ])
  return <div ref={presentation} className="browser-chat-panel-settings">
    {groups.map(group => <fieldset key={group.key}>
      <legend>{group.label}</legend>
      {group.actions.map(action => <label key={action.key}>
        {action.icon}<span>{action.label}</span>
        <input type="checkbox" checked={action.checked} disabled={action.disabled} onChange={() => action.run()} />
      </label>)}
    </fieldset>)}
  </div>
}
