import { createContext, useContext, type ReactNode } from 'react'

const SettingsContext = createContext<ReactNode>(null)

export function BrowserSidebarSettings() { return useContext(SettingsContext) }

export function BrowserSidebarNavigation({ settings, children }: { settings: ReactNode; children: ReactNode }) {
  return <SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider>
}
