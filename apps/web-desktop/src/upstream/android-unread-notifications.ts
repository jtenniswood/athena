import { $hapticsMuted } from '@/store/haptics'
import { $nativeNotifyPrefs } from '@/store/native-notifications'
import { $cronSessions, $messagingSessions, $sessions, $unreadFinishedSessionIds, sessionMatchesStoredId, sessionPinId } from '@/store/session'
import { androidVisibleSession, showAndroidNotification } from '../platform/android'

/** Watch the same unread state as the sidebar, including updates from outside this WebView's chat socket. */
export function installAndroidUnreadNotifications(): () => void {
  const startedAt = Date.now() / 1000
  const sources = [$sessions, $cronSessions, $messagingSessions]
  const rows = () => sources.flatMap(source => source.get())
  const key = (row: ReturnType<typeof rows>[number]) => JSON.stringify([row.profile || 'default', sessionPinId(row)])
  const observed = new Map<string, { id: string; messages: number; activity: number }>()
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

    if (prefs.enabled && prefs.kinds.turnDone) {
      for (const [owner, row] of current) {
        if (row.archived || (visible && sessionMatchesStoredId(row, visible))) continue
        const previous = observed.get(owner)
        const liveCompletion = finished.has(row.id) && !previousFinished.has(row.id)
        const newMessages = previous?.id === row.id
          ? row.message_count > previous.messages
          : row.message_count > 0 && row.last_active > (previous?.activity ?? startedAt)
        // A manual mark-unread or an initial list of old unread chats is not new activity.
        if (!liveCompletion && !(newMessages && (row.unread || finished.has(row.id)))) continue
        void showAndroidNotification({
          kind: 'turnDone',
          chatTitle: row.title,
          chatAliases: [sessionPinId(row), ...(row._lineage_ids ?? [])],
          focusSessionId: row.id,
          focusProfile: row.profile || 'default',
          tag: 'android:' + row.id,
          body: 'You have new unread messages.',
          silent: $hapticsMuted.get()
        })
      }
    }
    // Keep a bounded baseline for rows temporarily removed by profile and list filters.
    for (const [owner, row] of current) remember(owner, row)
    for (const owner of observed.keys()) {
      if (observed.size <= 2000) break
      observed.delete(owner)
    }
    previousFinished = finished
  }

  const schedule = () => {
    if (queued) return
    queued = true
    queueMicrotask(reconcile)
  }
  const unlisten = [...sources, $unreadFinishedSessionIds].map(source => source.listen(schedule))
  return () => {
    stopped = true
    for (const stop of unlisten) stop()
  }
}
