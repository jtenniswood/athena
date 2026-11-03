import { useLayoutEffect } from 'react'
import { atom } from 'nanostores'
import { useStore } from '@nanostores/react'
import { Codicon } from '../../upstream/browser-api'
import { NAVIGATION_TABS, NAVIGATION_TAB_LABELS } from '../browser-preferences'
import type { useBrowserNavigation } from '../navigation'
import type { BrowserActionGroup } from '../ui/action-surface'

// Settings overlays are siblings of the shell, so publish its live commands.
const $chatPanelSettings = atom<BrowserActionGroup[]>([])

export function useChatPanelSettings(navigation: ReturnType<typeof useBrowserNavigation>) {
  useLayoutEffect(() => { $chatPanelSettings.set(chatPanelSettingsGroups(navigation)) })
  useLayoutEffect(() => () => { $chatPanelSettings.set([]) }, [])
}

/** Reuse the live navigation commands and their existing preference owners. */
function chatPanelSettingsGroups(navigation: ReturnType<typeof useBrowserNavigation>): BrowserActionGroup[] {
  return [
    { key: 'tabs', label: 'Tabs', actions: NAVIGATION_TABS.map(value => ({
      key: value,
      label: NAVIGATION_TAB_LABELS[value],
      icon: <Codicon name={value === 'sessions' ? 'history' : 'hubot'} />,
      checked: navigation.visibleTabs.includes(value),
      disabled: navigation.visibleTabs.includes(value) && navigation.visibleTabs.length === 1,
      run: () => navigation.toggleTab(value)
    })) },
    { key: 'sections', label: 'Sections', actions: navigation.sections.actions }
  ]
}

export function BrowserChatPanelPage() {
  const groups = useStore($chatPanelSettings)
  return <div className="browser-chat-panel-settings">
    {groups.map(group => <fieldset key={group.key}>
      <legend>{group.label}</legend>
      {group.actions.map(action => <label key={action.key}>
        {action.icon}<span>{action.label}</span>
        <input type="checkbox" checked={action.checked} disabled={action.disabled} onChange={() => action.run()} />
      </label>)}
    </fieldset>)}
    <p>Keep at least one tab visible.</p>
  </div>
}
