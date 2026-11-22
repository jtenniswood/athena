import { createContext, useContext, type ReactNode } from 'react'

type SidebarNavigationControls = { footerActions: ReactNode; searchFocusRequest: number }
const SidebarNavigationContext = createContext<SidebarNavigationControls>({ footerActions: null, searchFocusRequest: 0 })

export function useBrowserSidebarNavigation() { return useContext(SidebarNavigationContext) }

export function BrowserSidebarNavigation({ footerActions, searchFocusRequest, children }: SidebarNavigationControls & { children: ReactNode }) {
  return <SidebarNavigationContext.Provider value={{ footerActions, searchFocusRequest }}>{children}</SidebarNavigationContext.Provider>
}
