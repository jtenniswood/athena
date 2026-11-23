import { Codicon } from '@/components/ui/codicon'
import { useI18n } from '@/i18n'
import { requestProfileCreate } from '@/store/profile'
import { runImportProfileFlow } from '@/store/profile-share'
import type { BrowserActionGroup } from '../experience/ui/action-surface'
import { setBrowserProfilesCombined } from './profile-section'

export function useBrowserProfileMenuActions(combined: boolean, onLayoutChange: () => void): BrowserActionGroup[] {
  const { t } = useI18n()
  function changeLayout(value: boolean) {
    if (combined === value) return
    onLayoutChange()
    setBrowserProfilesCombined(value)
  }
  return [
    { key: 'layout', selection: 'single', actions: [
      { key: 'combined', label: 'Combined', checked: combined, afterClose: true, run: () => changeLayout(true) },
      { key: 'separate', label: 'Separate', checked: !combined, afterClose: true, run: () => changeLayout(false) }
    ] },
    { key: 'manage', actions: [
      { key: 'new-profile', label: t.profiles.newProfile, icon: <Codicon name="add" />, afterClose: true, run: requestProfileCreate },
      { key: 'import-profile', label: t.profiles.importProfile, icon: <Codicon name="cloud-download" />, afterClose: true, run: () => void runImportProfileFlow() }
    ] }
  ]
}
