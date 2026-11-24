import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { requestProfileCreate } from '@/store/profile'
import { runImportProfileFlow } from '@/store/profile-share'
import type { BrowserAction } from '../experience/ui/action-surface'
import { setBrowserProfilesCombined } from './profile-section'

export function useBrowserProfileMenuActions(combined: boolean, onLayoutChange: () => void): { manage: BrowserAction[]; layout: BrowserAction } {
  const { t } = useI18n()
  function changeLayout(value: boolean) {
    if (combined === value) return
    onLayoutChange()
    setBrowserProfilesCombined(value)
  }
  return {
    manage: [
      { key: 'new-profile', label: t.profiles.newProfile, icon: <Codicon name="add" />, afterClose: true, run: requestProfileCreate },
      { key: 'import-profile', label: t.profiles.importProfile, icon: <Codicon name="cloud-download" />, afterClose: true, run: () => void runImportProfileFlow() }
    ],
    layout: {
      key: 'profile-layout',
      label: 'Profile layout',
      icon: <Codicon name="layout" />,
      children: [{ key: 'layout-options', selection: 'single', actions: [
        { key: 'combined', label: 'Combined', checked: combined, afterClose: true, run: () => changeLayout(true) },
        { key: 'separate', label: 'Separate', checked: !combined, afterClose: true, run: () => changeLayout(false) }
      ] }],
      run: () => {}
    }
  }
}
