import { createContext, useContext, type ReactNode } from 'react'
import type { BrowserEngine } from './contracts/engine'

const Engine = createContext<BrowserEngine | null>(null)

/** One immutable host implementation per mounted application, with no shadow state. */
export function BrowserEngineProvider({ engine, children }: { engine: BrowserEngine; children: ReactNode }) {
  if (engine.protocol !== 1) throw new Error('Unsupported browser engine protocol')
  return <Engine.Provider value={engine}>{children}</Engine.Provider>
}

export function useBrowserEngine(): BrowserEngine {
  const engine = useContext(Engine)
  if (!engine) throw new Error('The browser engine host is unavailable')
  return engine
}
