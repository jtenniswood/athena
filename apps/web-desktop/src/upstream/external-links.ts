import { externalUrlTarget } from '@hermes/shared'

/** Apply the renderer's public URL policy to the browser's external-link capability. */
export async function openBrowserExternalLink(url: string): Promise<void> {
  const target = externalUrlTarget(url)
  if (target?.kind === 'web') window.open(target.url, '_blank', 'noopener,noreferrer')
}
