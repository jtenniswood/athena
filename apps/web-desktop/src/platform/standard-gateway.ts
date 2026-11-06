import { apiFetch, resolveToken } from './connection'

export type StandardSocket = 'gateway' | 'speak-stream' | 'transcribe-stream'

/** The standard serve listener uses its existing login and the renderer's legacy wire support. */
export async function standardGatewaySocket(socket: StandardSocket, profile?: string | null): Promise<string> {
  let credential = 'ticket'
  let ticket: string | undefined
  try {
    ticket = (await apiFetch<{ ticket?: string }>({ method: 'POST', path: '/api/auth/ws-ticket' })).ticket
  } catch (error) {
    if (!/^401:/.test(String(error instanceof Error ? error.message : error))) throw error
    if (!resolveToken()) throw Object.assign(new Error('Hermes sign-in is required. Sign in again in Gateway settings.'), { needsOauthLogin: true })
    // A loopback serve token has no cookie session. Keep it out of socket URLs:
    // the image exchanges it for a short-lived, single-use local handle.
    const query = new URLSearchParams({ socket, ...(profile ? { profile } : {}) })
    ticket = (await apiFetch<{ ticket?: string }>({ method: 'POST', path: '/api/athena/gateway/token-ticket?' + query })).ticket
    credential = 'athena_token_ticket'
  }
  if (!ticket) throw new Error('Hermes did not return a connection ticket.')
  const url = new URL('/api/athena/gateway/ws', window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('socket', socket)
  url.searchParams.set(credential, ticket)
  if (profile) url.searchParams.set('profile', profile)
  return url.toString()
}
