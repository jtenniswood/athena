import { createContext, useContext, type ReactNode } from 'react'

type SidebarNavigationControls = { searchFocusRequest: number }
const SidebarNavigationContext = createContext<SidebarNavigationControls>({ searchFocusRequest: 0 })

export function useBrowserSidebarNavigation() { return useContext(SidebarNavigationContext) }

export function BrowserSidebarNavigation({ searchFocusRequest, children }: SidebarNavigationControls & { children: ReactNode }) {
  return <SidebarNavigationContext.Provider value={{ searchFocusRequest }}>{children}</SidebarNavigationContext.Provider>
}
