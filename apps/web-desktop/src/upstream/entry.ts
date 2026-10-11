/** Evaluate upstream startup only after the caller prepares the browser bridge. */
export async function startUpstreamRenderer(): Promise<void> {
  const { initializeBrowserShell } = await import('./browser-initialize')
  initializeBrowserShell()
  await import('../../../desktop/src/main')
}
