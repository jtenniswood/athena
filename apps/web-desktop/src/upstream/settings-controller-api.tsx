import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useStore } from '@nanostores/react'
import { $settingsRequestProfile } from '@/store/settings-scope'
import { useRendererSettingsController } from 'hermes:settings-controller'
import { SettingsBreadcrumbContext } from '@/app/settings/primitives'
import type { BrowserSettingsController, BrowserSettingsPageProps } from '../experience/contracts/settings'
import { BrowserSettingsToolContent, SETTINGS_TOOL_PAGES } from './settings-tools'

export function BrowserSettingsControllerSurface({ children, ...props }: BrowserSettingsPageProps & { children(controller: BrowserSettingsController): ReactNode }) {
  return children(useBrowserSettingsController(props))
}

/** Project commands and page controls; schemas, values, caches, and save owners stay in Hermes. */
export function useBrowserSettingsController({ onClose, onConfigSaved, onMainModelChanged }: BrowserSettingsPageProps) {
  const controller = useRendererSettingsController({ onClose, onConfigSaved, onMainModelChanged })
  const scope = useStore($settingsRequestProfile) ?? ''
  return {
    view: controller.activeView,
    scope,
    nativePages: controller.navGroups,
    openPage: (view: string) => controller.openSettingsPage(view as Parameters<typeof controller.openSettingsPage>[0]),
    labels: controller.labels,
    search: controller.search,
    content: <SettingsBreadcrumbContext.Provider value={false}>
      {controller.needsSubpageRedirect
        ? <Navigate replace to={controller.redirect} />
        : SETTINGS_TOOL_PAGES.some(page => page.id === controller.activeView)
          ? <BrowserSettingsToolContent view={controller.activeView} onClose={onClose} />
          : controller.content}
    </SettingsBreadcrumbContext.Provider> as ReactNode
  }
}
