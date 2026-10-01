import type { Plugin } from 'vite'

const WORDMARK = "const WORDMARK = 'HERMES AGENT'"
const ROTATING_COPY = 'const copy = resolveCopy(personality, mountSeed + (seed ?? 0))'

/** Apply Athena's browser-only name and fixed empty-chat tagline upstream. */
export function athenaBranding(): Plugin {
  return {
    name: 'athena:empty-chat-branding',
    enforce: 'pre',
    transform(code, id) {
      const normalized = id.replaceAll('\\', '/').split('?')[0]
      if (!normalized.endsWith('/desktop/src/components/chat/intro.tsx')) return null
      if (code.split(WORDMARK).length !== 2 || code.split(ROTATING_COPY).length !== 2) {
        throw new Error('Athena intro branding contract changed in the pinned renderer')
      }
      return {
        code: code
          .replace(WORDMARK, "const WORDMARK = 'ATHENA'")
          .replace(ROTATING_COPY, "const copy = { body: 'Athena for Hermes Agent' }"),
        map: null
      }
    }
  }
}
