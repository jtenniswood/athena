import type { FunctionComponent, ReactNode } from 'react'

export interface BrowserPanelEntry {
  id: string
  collapsible: boolean
}

export interface BrowserSettingsPageProps {
  gateway?: unknown
  onClose(): void
  onConfigSaved?(): void
  onMainModelChanged?(provider: string, model: string): void
}

export interface BrowserSettings {
  activityToasts: { enabled: boolean; toggle: () => void }
  panels: readonly {
    id: string
    checked: boolean | undefined
    /** True when opening; false when closing an already visible desktop pane. */
    select: (mode?: 'open' | 'toggle') => boolean
  }[]
}
export interface BrowserSettingsNavigation {
  id: string
  label: string
  active: boolean
  icon: FunctionComponent<{ className?: string }>
  onSelect(): void
  children?: BrowserSettingsNavigation[]
}

export interface BrowserSettingsController {
  view: string
  scope: string
  nativePages: BrowserSettingsNavigation[]
  openPage(view: string): void
  labels: { back: string; close: string; title: string }
  search: { label: string; hint: string; active: boolean; open(): void }
  content: ReactNode
}
