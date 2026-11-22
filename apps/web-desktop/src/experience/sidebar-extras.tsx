import { createContext, useContext, type ReactNode } from 'react'

type SidebarNavigationControls = { settings: ReactNode; searchFocusRequest: number }
const SidebarNavigationContext = createContext<SidebarNavigationControls>({ settings: null, searchFocusRequest: 0 })

export function useBrowserSidebarNavigation() { return useContext(SidebarNavigationContext) }

export function BrowserSidebarNavigation({ settings, searchFocusRequest, children }: SidebarNavigationControls & { children: ReactNode }) {
  return <SidebarNavigationContext.Provider value={{ settings, searchFocusRequest }}>{children}</SidebarNavigationContext.Provider>
}
