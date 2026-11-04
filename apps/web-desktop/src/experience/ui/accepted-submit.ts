export interface BrowserAcceptedSubmit {
  text: string
}

type AcceptedSubmit = (detail: BrowserAcceptedSubmit) => void
const surfaces = new Map<string, AcceptedSubmit>()

/** Only the mounted transcript for this engine surface receives its command. */
export function subscribeBrowserAcceptedSubmit(surfaceId: string, accept: AcceptedSubmit): () => void {
  surfaces.set(surfaceId, accept)
  return () => { if (surfaces.get(surfaceId) === accept) surfaces.delete(surfaceId) }
}

/** Presentation failures must not reject a send the engine already accepted. */
export function announceBrowserAcceptedSubmit(surfaceId: string | null, detail: BrowserAcceptedSubmit): void {
  if (!surfaceId) return
  try { surfaces.get(surfaceId)?.(detail) }
  catch (error) { console.error('Could not position the accepted message.', error) }
}
