import { onGatewayEvent } from '@/contrib/events'
import { getSessionMessages, type SessionInfo } from '@/hermes'
import { chatMessageText, toChatMessages } from '@/lib/chat-messages'
import { requestGatewayForAgent } from '@/store/gateway'
import { ownerLookupSessionRows, sessionMatchesStoredId } from '@/store/session'
import { $workingSessionIds, storedSessionIdForRuntimeId } from '@/store/session-states'
import { browserPreferenceAccountId, subscribePreferenceSync } from '../platform/preference-sync'
import { runtimeConfig } from '../platform/runtime'
import { createSessionSummaries, SUMMARY_INSTRUCTIONS, type SummarySession } from '../platform/session-summaries'
import { WEB_CONNECTION_ID } from '../platform/connection'

let summaries: ReturnType<typeof createSessionSummaries> | undefined

function service() {
  return summaries ??= createSessionSummaries({
    storage: { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) },
    account: browserPreferenceAccountId,
    gateway: runtimeConfig().gateway.id,
    async context(session) {
      const scope = { profile: session.profile || 'default', connectionId: session.connection_id || WEB_CONNECTION_ID }
      const [head, tail] = await Promise.all([
        getSessionMessages(session.id, scope, { limit: 24, order: 'oldest', includeCompacted: true }, { passive: true }),
        getSessionMessages(session.id, scope, { limit: 60, order: 'latest', includeCompacted: true }, { passive: true })
      ])
      // Older gateways can ignore ordering. Avoid summarizing an arbitrary middle of a chat.
      if (tail.pagination?.order !== 'latest' && (session.message_count > tail.messages.length || tail.messages.length >= 60)) {
        throw new Error('Latest transcript ordering is unavailable')
      }
      const visible = (page: typeof head) => toChatMessages(page.messages).filter(message => !message.hidden && !message.interim)
      const text = (value: string) => value.trim().slice(0, 1200)
      const user = (page: typeof head) => visible(page).filter(message => message.role === 'user')
        .map(message => text(chatMessageText(message))).filter(Boolean)
      const reply = visible(tail).findLast(message => message.role === 'assistant')
      return {
        opening: user(head).slice(0, 3),
        recent: user(tail).slice(-5),
        reply: reply ? text(chatMessageText(reply)) : ''
      }
    },
    async generate(session, input) {
      if ($workingSessionIds.get().includes(session.id)) throw new Error('Conversation is still running')
      // No session_id: resolve the profile's title auxiliary slot, then its default model.
      // A live session-bound helper would otherwise inherit the foreground chat's route.
      const result = await requestGatewayForAgent<{ text: string }>(session.connection_id || WEB_CONNECTION_ID,
        session.profile || 'default', 'llm.oneshot', {
          task: 'title_generation', instructions: SUMMARY_INSTRUCTIONS, input, max_tokens: 160, temperature: 0.2
        }, 65_000)
      return result.text
    },
    async fingerprint(input) {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    },
    lock: (key, work) => navigator.locks ? navigator.locks.request(`athena.summary.${key}`, work) : work()
  })
}

export const readPreviewSummary = (session: SummarySession) => service().get(session)
export const refreshPreviewSummary = (session: SummarySession, force = false) =>
  $workingSessionIds.get().includes(session.id) ? Promise.resolve() : service().refresh(session, force)
export function subscribePreviewSummaries(listener: () => void) {
  const stop = service().subscribe(listener), stopAccount = subscribePreferenceSync(listener)
  const storage = (event: StorageEvent) => { if (!event.key || event.key.startsWith('athena.session-summaries.')) listener() }
  window.addEventListener('storage', storage)
  return () => { stop(); stopAccount(); window.removeEventListener('storage', storage) }
}

/** Only fresh completed turns enqueue automatic work; opening old previews fills their cache lazily. */
export function installBrowserSessionSummaries(): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const stop = onGatewayEvent('message.complete', event => {
    if (event.replayed || !event.session_id) return
    const runtime = event.session_id
    const stored = storedSessionIdForRuntimeId(runtime) || runtime
    const profile = event.profile
    const connection = event.connectionId || WEB_CONNECTION_ID
    const key = JSON.stringify([connection, profile, stored])
    clearTimeout(timers.get(key))
    timers.set(key, setTimeout(() => {
      timers.delete(key)
      const rows = ownerLookupSessionRows().filter(row =>
        (row.connection_id || WEB_CONNECTION_ID) === connection && (!profile || (row.profile || 'default') === profile) &&
        (sessionMatchesStoredId(row, stored) || sessionMatchesStoredId(row, runtime)))
      // An unowned/ambiguous completion never borrows the current conversation's profile.
      if (rows.length === 1) void refreshPreviewSummary(rows[0], true)
    }, 2000))
  })
  return () => { stop(); for (const timer of timers.values()) clearTimeout(timer); timers.clear() }
}
