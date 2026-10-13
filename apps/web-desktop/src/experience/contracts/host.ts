export interface BrowserHostPanel {
  id: string
  label: string
  checked: boolean | undefined
  select(mode?: 'open' | 'toggle'): boolean
}
