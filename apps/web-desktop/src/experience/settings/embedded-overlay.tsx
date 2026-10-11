import { createContext, useContext, type ReactNode } from 'react'

export const BrowserSettingsEmbeddedOverlay = createContext(false)
export const BrowserSettingsToolActions = createContext<{
  onDeleteSession: (sessionId: string) => Promise<void>
  onOpenSession: (sessionId: string) => void
} | null>(null)

export function useSettingsEmbeddedOverlay() {
  return useContext(BrowserSettingsEmbeddedOverlay)
}

export function BrowserSettingsEmbeddedContent({ children }: { children: ReactNode }) {
  return <div className="browser-settings-embedded-content">{children}</div>
}
