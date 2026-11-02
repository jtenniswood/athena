import { BROWSER_TOOL_ROUTES } from './tool-routes'
import { createContext, useContext, type ReactNode } from 'react'
import { BrowserNavigationSection } from './ui/navigation-section'
import { Codicon } from '../upstream/browser-api'

const SettingsContext = createContext<ReactNode>(null)

export function BrowserSidebarSettings() { return useContext(SettingsContext) }

const NavigateContext = createContext<(path: string) => void>(() => {})


export function BrowserSidebarNavigation({ onNavigate, settings, children }: { onNavigate: (path: string) => void; settings: ReactNode; children: ReactNode }) {
  return <NavigateContext.Provider value={onNavigate}><SettingsContext.Provider value={settings}>{children}</SettingsContext.Provider></NavigateContext.Provider>
}

export function BrowserSidebarExtras() {
  const navigate = useContext(NavigateContext)
  return <BrowserNavigationSection id="browser-extra-controls" label="More controls">
    {BROWSER_TOOL_ROUTES.map(route => <button key={route.path} type="button" onClick={() => navigate(route.path)}>
      <Codicon name={route.icon} size="1rem" /><span>{route.label}</span>
    </button>)}
  </BrowserNavigationSection>
}
