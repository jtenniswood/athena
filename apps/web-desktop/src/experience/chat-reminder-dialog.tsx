import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle, useI18n } from '../upstream/browser-api'
import { Button, Input } from '../upstream/ui'
import { isAndroidApp } from '../platform/android'
import { browserPushEnabled } from '../platform/browser-push'
import { cancelChatReminder, readChatReminder, scheduleChatReminder, type ReminderChat } from '../platform/chat-reminders'
import { useBrowserDialogReturnFocus } from './ui/dialog-focus'

const times = [
  ['half-hour', 'In 30 minutes'],
  ['hour', 'In 1 hour'],
  ['three-hours', 'In 3 hours'],
  ['tomorrow', 'Tomorrow at 9:00 AM'],
  ['monday', 'Next Monday at 9:00 AM'],
  ['custom', 'Custom date and time']
] as const

type ReminderTime = typeof times[number][0]
const minutes = { 'half-hour': 30, hour: 60, 'three-hours': 180 }
const formatReminder = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function reminderTimestamp(time: ReminderTime, custom: string): number {
  if (time === 'custom') return new Date(custom).getTime()
  if (time in minutes) return Date.now() + minutes[time as keyof typeof minutes] * 60_000
  const date = new Date()
  const days = time === 'tomorrow' ? 1 : (8 - date.getDay()) % 7 || 7
  date.setDate(date.getDate() + days)
  date.setHours(9, 0, 0, 0)
  return date.getTime()
}

function localDateTime(timestamp: number): string {
  const offset = new Date(timestamp).getTimezoneOffset() * 60_000
  return new Date(timestamp - offset).toISOString().slice(0, 16)
}

function reminderError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  const response = error.message.match(/^\d+: (.+)$/)?.[1]
  if (!response) return error instanceof TypeError ? fallback : error.message
  try { return (JSON.parse(response) as { error?: string }).error || fallback }
  catch { return fallback }
}

export function ChatReminderDialog({ sessionId, profile, title, onClose }: ReminderChat & { title?: string; onClose(): void }) {
  const { t } = useI18n()
  const [time, setTime] = useState<ReminderTime>('half-hour')
  const [custom, setCustom] = useState('')
  const [dueAt, setDueAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [removed, setRemoved] = useState(false)
  const returnFocus = useBrowserDialogReturnFocus(true)

  useEffect(() => {
    let current = true
    void readChatReminder({ sessionId, profile }).then(saved => {
      if (!current || !saved) return
      setDueAt(saved)
      setTime('custom')
      setCustom(localDateTime(saved))
    }).catch(cause => {
      if (current) setError(reminderError(cause, 'Could not check for an existing reminder.'))
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [sessionId, profile])

  const save = async () => {
    const next = time === 'custom' && dueAt && custom === localDateTime(dueAt) ? dueAt : reminderTimestamp(time, custom)
    if (!Number.isFinite(next) || next <= Date.now()) {
      setError('Choose a date and time in the future.')
      return
    }
    setBusy(true)
    setError('')
    setRemoved(false)
    try {
      await scheduleChatReminder({ sessionId, profile }, next)
      setDueAt(next)
    } catch (cause) { setError(reminderError(cause, 'Could not save the reminder. Try again.')) }
    finally { setBusy(false) }
  }

  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      await cancelChatReminder({ sessionId, profile })
      setDueAt(null)
      setRemoved(true)
    } catch (cause) { setError(reminderError(cause, 'Could not remove the reminder. Try again.')) }
    finally { setBusy(false) }
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
    <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto" onCloseAutoFocus={returnFocus}>
      <DialogTitle>Remind me</DialogTitle>
      <DialogDescription className="break-words">{title || 'Get a notification to return to this chat.'}</DialogDescription>
      <form className="grid gap-4" onSubmit={event => {
        event.preventDefault()
        if (!loading && !busy) void save()
      }}>
        <fieldset disabled={loading || busy} className="grid gap-0.5">
          <legend className="mb-1 text-sm font-medium">When</legend>
          {times.map(([value, label]) => <label key={value}
            className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-(--ui-control-active-background)">
            <input type="radio" name="reminder-time" value={value} checked={time === value} onChange={() => {
              setTime(value)
              if (value === 'custom' && !custom) setCustom(localDateTime(dueAt && dueAt > Date.now() ? dueAt : reminderTimestamp('hour', '')))
            }} />
            {label}
          </label>)}
          {time === 'custom' && <Input type="datetime-local" aria-label="Reminder date and time" className="mt-1" required
            value={custom} onChange={event => setCustom(event.target.value)} />}
        </fieldset>
        {!dueAt && !isAndroidApp() && !browserPushEnabled() && <p className="text-sm text-muted-foreground">
          Setting a reminder enables background delivery on this browser.
        </p>}
        {(loading || dueAt || removed) && <p className="text-sm text-muted-foreground" role="status">
          {loading ? 'Checking for a reminder…' : dueAt ? 'Scheduled for ' + formatReminder.format(dueAt) + ' on this device.' : 'Reminder removed.'}
        </p>}
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {dueAt && <Button type="button" variant="ghost" className="mr-auto" disabled={busy} onClick={() => void remove()}>Remove reminder</Button>}
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{dueAt || removed ? t.common.done : t.common.cancel}</Button>
          <Button type="submit" disabled={loading || busy}>{dueAt ? 'Update reminder' : 'Set reminder'}</Button>
        </div>
      </form>
    </DialogContent>
  </Dialog>
}
