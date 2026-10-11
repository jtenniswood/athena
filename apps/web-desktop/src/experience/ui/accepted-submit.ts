export const BROWSER_SUBMIT_ACCEPTED_EVENT = 'athena:composer-submit-accepted'

export interface BrowserAcceptedSubmit {
  text: string
  sessionId: string | null
}

/** Announce only after the renderer's submit callback accepts the message. */
export function announceBrowserAcceptedSubmit(detail: BrowserAcceptedSubmit): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<BrowserAcceptedSubmit>(BROWSER_SUBMIT_ACCEPTED_EVENT, { detail }))
}
