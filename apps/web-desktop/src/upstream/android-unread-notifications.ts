import { chatMessageText, toChatMessages } from '@/lib/chat-messages'
import { getSessionMessages } from '@/hermes'
import { $workingSessionIds } from '@/store/session-states'
import { notificationChatTitle, notificationSnippet } from '../../server/android-notification-content.mjs'
import { $hapticsMuted } from '@/store/haptics'
import { $nativeNotifyPrefs } from '@/store/native-notifications'
import { $cronSessions, $messagingSessions, $sessions, $unreadFinishedSessionIds, sessionMatchesStoredId, sessionPinId } from '@/store/session'
import { androidVisibleSession, showAndroidNotification } from '../platform/android'
import { WEB_CONNECTION_ID } from '../platform/connection'

/** Watch the same unread state as the sidebar, including updates from outside this WebView's chat socket. */
export function installAndroidUnreadNotifications(): () => void {
  const startedAt = Date.now() / 1000
  const sources = [$sessions, $cronSessions, $messagingSessions]
  const rows = () => sources.flatMap(source => source.get())
  const key = (row: ReturnType<typeof rows>[number]) => JSON.stringify([row.connection_id || WEB_CONNECTION_ID, row.profile || 'default', sessionPinId(row)])
  const observed = new Map<string, { id: string; messages: number; activity: number }>()
  const lastAlertedReply = new Map<string, string>()
  const pending = new Map<string, { expires: number; reading: boolean }>()
  const remember = (owner: string, row: ReturnType<typeof rows>[number]) => {
    observed.delete(owner)
    observed.set(owner, { id: row.id, messages: row.message_count, activity: row.last_active })
  }
  for (const row of rows()) remember(key(row), row)
  let previousFinished = new Set($unreadFinishedSessionIds.get())
  let queued = false
  let stopped = false

  const reconcile = () => {
    queued = false
    if (stopped) return
    const finished = new Set($unreadFinishedSessionIds.get())
    const current = new Map(rows().map(row => [key(row), row]))
    const prefs = $nativeNotifyPrefs.get()
    const visible = document.visibilityState === 'visible' && document.hasFocus() ? androidVisibleSession() : null

    const enabled = prefs.enabled && prefs.kinds.turnDone
    if (!enabled) pending.clear()
    if (enabled) {
      for (const [owner, row] of current) {
        if (row.archived || (visible && sessionMatchesStoredId(row, visible))) continue
        const previous = observed.get(owner)
        const liveCompletion = finished.has(row.id) && !previousFinished.has(row.id)
        const newMessages = previous?.id === row.id
          ? row.message_count > previous.messages
          : row.message_count > 0 && row.last_active > (previous?.activity ?? startedAt)
        // A manual mark-unread or an initial list of old unread chats is not new activity.
        if (liveCompletion || (newMessages && (row.unread || finished.has(row.id)))) {
          pending.set(owner, { expires: Date.now() + 120_000, reading: false })
        }
      }
    }
    for (const [owner, alert] of pending) {
      const row = current.get(owner)
      if (alert.expires <= Date.now() || row?.archived ||
          (row && ((visible && sessionMatchesStoredId(row, visible)) || (!row.unread && !finished.has(row.id))))) {
        pending.delete(owner)
        continue
      }
      if (!row || alert.reading || !notificationChatTitle(row.title) || row.scheduler_owned ||
          $workingSessionIds.get().includes(row.id)) continue
      alert.reading = true
      const profile = row.profile || 'default'
      void getSessionMessages(row.id, { profile, connectionId: row.connection_id || undefined },
        { limit: 12, order: 'latest' }, { passive: true }).then(page => {
        if (stopped || pending.get(owner) !== alert) return
        const latest = rows().find(candidate => key(candidate) === owner)
        if (!latest || latest.id !== row.id || latest.message_count !== row.message_count) {
          alert.reading = false
          schedule()
          return
        }
        pending.delete(owner)
        const settings = $nativeNotifyPrefs.get()
        const visibleNow = document.visibilityState === 'visible' && document.hasFocus() ? androidVisibleSession() : null
        const title = notificationChatTitle(latest.title)
        if (!settings.enabled || !settings.kinds.turnDone || !title || latest.archived ||
            (visibleNow && sessionMatchesStoredId(latest, visibleNow)) ||
            (!latest.unread && !$unreadFinishedSessionIds.get().includes(latest.id))) return
        if (page.pagination?.order !== 'latest' && row.message_count > page.messages.length) return
        const message = page.messages.at(-1)
        const metadata = message?.display_metadata
        const note = message?.display_kind !== 'hidden' && typeof metadata === 'object' && metadata !== null &&
          'completion_note' in metadata && Array.isArray(metadata.completion_note) && metadata.completion_note.length > 0 &&
          (!('notification_category' in metadata) || metadata.notification_category !== 'diagnostic') &&
          typeof message?.content === 'string' ? message : undefined
        const reply = toChatMessages(page.messages).findLast(message =>
          !message.hidden && !message.interim && ['assistant', 'user'].includes(message.role) && chatMessageText(message).trim())
        const body = notificationSnippet(note?.content ?? (reply?.role === 'assistant' ? chatMessageText(reply) : ''))
        const replyId = note?.id != null ? String(note.id) : reply?.id
        if (!body || /^\[SILENT\]$/i.test(body) || !replyId || lastAlertedReply.get(owner) === replyId) return
        lastAlertedReply.set(owner, replyId)
        void showAndroidNotification({
          kind: 'turnDone', chatTitle: title, focusSessionId: row.id, focusProfile: profile,
          chatAliases: [sessionPinId(latest), ...(latest._lineage_ids ?? [])],
          tag: 'android:' + row.id, body, silent: $hapticsMuted.get()
        })
      }).catch(() => { alert.reading = false })
    }
    // Keep a bounded baseline for rows temporarily removed by profile and list filters.
    for (const [owner, row] of current) remember(owner, row)
    for (const owner of observed.keys()) {
      if (observed.size <= 2000) break
      observed.delete(owner)
      lastAlertedReply.delete(owner)
      pending.delete(owner)
    }
    previousFinished = finished
  }

  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(reconcile)
  }
  const unlisten = [...sources, $unreadFinishedSessionIds, $workingSessionIds, $nativeNotifyPrefs].map(source => source.listen(schedule))
  return () => {
    stopped = true
    pending.clear()
    for (const stop of unlisten) stop()
  }
}
