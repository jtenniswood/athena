import type { BrowserHostGlobals, HermesApiRequest } from '../upstream/types'

let transport: { api<T>(request: HermesApiRequest): Promise<T>; token(): string } | undefined

export function installOfficialHostTransport(owner: NonNullable<typeof transport>): void { transport = owner }
export function officialHostTransport(): typeof transport { return transport }

/** The serving Hermes release owns authentication and browser transport. */
export function usesOfficialWebappHost(): boolean {
  if (typeof window === 'undefined') return false
  const host = window as Window & BrowserHostGlobals
  return host.__HERMES_AUTH_REQUIRED__ === true || host.__HERMES_UI_SURFACE__ === 'webapp'
}
