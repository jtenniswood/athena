import { runtimeConfig } from './runtime'

export interface SignInProvider {
  name: string
  display_name: string
  supports_password: boolean
}

export class SignInConfigurationError extends Error {}

/** Select only a login route on Hermes; its backend still verifies credentials. */
export function browserSignInTarget(providers?: SignInProvider[], returnTo?: string): { path: string; label: string } {
  const mode = runtimeConfig().auth?.mode || 'auto'
  const params = new URLSearchParams()
  if (returnTo) params.set('next', returnTo)
  if (mode === 'oidc') {
    if (providers && !providers.some(provider => provider.name === 'self-hosted' && !provider.supports_password)) {
      throw new SignInConfigurationError('OIDC sign-in is unavailable. Configure the self-hosted OIDC provider on your Hermes server.')
    }
    params.set('provider', 'self-hosted')
    return { path: `/auth/login?${params}`, label: 'Sign in with OIDC' }
  }
  if (mode === 'hermes') return { path: `/login${params.size ? `?${params}` : ''}`, label: 'Sign in with Hermes Agent' }
  const provider = providers?.length === 1 && !providers[0].supports_password ? providers[0] : null
  if (provider) params.set('provider', provider.name)
  return {
    path: `${provider ? '/auth/login' : '/login'}${params.size ? `?${params}` : ''}`,
    label: provider ? `Sign in with ${provider.display_name}` : 'Sign in'
  }
}
