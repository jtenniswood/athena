export interface BrowserHostPanel {
  id: string
  label: string
  checked: boolean | undefined
  select(mode?: 'open' | 'toggle'): boolean
}

export interface BrowserSidebarCommands {
  compact: boolean
  toggleDrawer(): void
  focusSearch(): void
}
