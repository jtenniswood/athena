export interface RuntimeConfigV1 {
  version: 1
  auth?: { mode: 'auto' | 'hermes' | 'oidc' }
  gateway: { id: string; name: string; legacyUrls: string[] }
  capabilities: { gatewaySelection: false; pluginAssets: true }
}

declare global {
  interface Window { __HERMES_RUNTIME_CONFIG__?: RuntimeConfigV1 }
}

export function runtimeConfig(): RuntimeConfigV1 {
  const config = window.__HERMES_RUNTIME_CONFIG__
  if (!config || config.version !== 1 || !/^[a-f0-9]{64}$/.test(config.gateway?.id) || typeof config.gateway.name !== 'string' || !Array.isArray(config.gateway.legacyUrls) || !config.gateway.legacyUrls.every(url => typeof url === 'string') || config.capabilities?.gatewaySelection !== false || config.capabilities.pluginAssets !== true) {
    throw new Error('Gateway configuration is unavailable. Reload the app after checking its web server configuration.')
  }
  if (config.auth !== undefined && !['auto', 'hermes', 'oidc'].includes(config.auth?.mode)) {
    throw new Error('Sign-in configuration is invalid. Check HERMES_AUTH_MODE on the web server.')
  }
  return config
}

export function configuredGatewayUrl(url: string): boolean {
  if (!url || url === '/') return true
  try {
    const parsed = new URL(url)
    return !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/' &&
      (parsed.origin === window.location.origin || runtimeConfig().gateway.legacyUrls.includes(parsed.origin))
  } catch { return false }
}
