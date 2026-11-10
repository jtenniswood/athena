import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $nativeNotifyPrefs } from '@/store/native-notifications'
import { Button } from '../../upstream/ui'
import { browserNotificationPermission, requestBrowserNotificationPermission } from '../../platform/notifications'
import { androidPushActive, isAndroidApp, refreshAndroidNotificationPermission } from '../../platform/android'
import { androidBackgroundAlerts, setAndroidBackgroundAlerts, testAndroidPush } from '../../platform/android-push'
import { useSettingsPresentation } from './presentation'

export function BrowserNotificationPermissionSetting() {
  const native = isAndroidApp()
  const [permission, setPermission] = useState(browserNotificationPermission)
  const [requesting, setRequesting] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(androidPushActive)
  const [background, setBackground] = useState(androidBackgroundAlerts)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [deliveryMessage, setDeliveryMessage] = useState('')
  const alertsEnabled = useStore($nativeNotifyPrefs).enabled

  const changeBackground = async (enabled: boolean) => {
    setBackground(enabled)
    setSaving(true)
    setDeliveryMessage('')
    try {
      if (!await setAndroidBackgroundAlerts(enabled)) {
        setDeliveryMessage('Could not update background delivery. Reopen Athena and try again.')
      }
    } finally { setSaving(false) }
  }

  const sendTest = async () => {
    setTesting(true)
    setDeliveryMessage('')
    try {
      await testAndroidPush()
      setDeliveryMessage('Firebase accepted the test. Check your Android notifications.')
    } catch (error) {
      const response = error instanceof Error ? error.message.match(/^\d+: (.+)$/)?.[1] : undefined
      let message = 'Could not send a push test. Check the Android push status in App settings.'
      if (response) {
        try { message = (JSON.parse(response) as { error?: string }).error || message } catch { /* Use the default message for proxy errors. */ }
      }
      setDeliveryMessage(message)
    } finally { setTesting(false) }
  }

  useEffect(() => {
    const update = () => { setPermission(browserNotificationPermission()); setPushEnabled(androidPushActive()) }
    const refresh = () => {
      update()
      if (native) void refreshAndroidNotificationPermission()
    }
    refresh()
    window.addEventListener('athena:notification-permission', update)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('athena:notification-permission', update)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [native])

  const description = permission === 'granted'
    ? 'Permission allowed. Choose your alerts below.'
    : permission === 'denied'
      ? native ? 'Blocked by Android. Open App settings → Android notification settings to allow alerts.' : 'Blocked by your browser. Allow notifications in Athena’s site settings.'
      : permission === 'insecure'
        ? 'Open Athena over HTTPS or localhost to enable browser notifications.'
        : permission === 'unsupported'
          ? 'Unavailable in this browser. On iPhone or iPad, add Athena to your Home Screen and open it there.'
          : 'Get alerts when a reply is ready while you’re away.'

  const requestPermission = async () => {
    setRequesting(true)
    try {
      setPermission(await requestBrowserNotificationPermission())
    } finally {
      setRequesting(false)
    }
  }
  const title = native ? 'Android notifications' : 'Browser notifications'
  const hint = native && pushEnabled ? 'The server can deliver replies from its retained chat connection while the app is closed.' : 'Alerts pause when Athena is closed or suspended.'
  const backgroundLabel = 'Background delivery on this device'
  const backgroundDescription = 'Use Firebase for reply alerts while the app is closed.'
  const testLabel = testing ? 'Sending push test…' : 'Send Android push test'
  const testDisabled = testing || saving || !background || !alertsEnabled || permission !== 'granted'
  const presentation = useSettingsPresentation([
    { kind: 'heading', label: title }, { kind: 'text', label: description },
    ...(permission === 'default' ? [{ id: 'permission', kind: 'action' as const,
      label: requesting ? 'Waiting for permission…' : 'Allow notifications', disabled: requesting, run: requestPermission }] : []),
    ...(['default', 'granted'].includes(permission) ? [{ kind: 'text' as const, label: hint }] : []),
    ...(native ? [
      { id: 'background-delivery', kind: 'toggle' as const, label: backgroundLabel, description: backgroundDescription,
        checked: background, disabled: saving, run: () => changeBackground(!background) },
      { id: 'push-test', kind: 'action' as const, label: testLabel, disabled: testDisabled, run: sendTest },
      ...(deliveryMessage ? [{ kind: 'text' as const, label: deliveryMessage }] : [])
    ] : [])
  ])

  return <section ref={presentation} className="browser-notification-permission" aria-label="Notification permission">
    <div className="browser-notification-permission-copy">
      <h3 className="browser-settings-page-title">{title}</h3>
      <p className="browser-settings-page-description" role="status">{description}</p>
    </div>
    {permission === 'default' && <Button disabled={requesting} aria-busy={requesting} onClick={() => void requestPermission()} type="button">
      {requesting ? 'Waiting for permission…' : 'Allow notifications'}
    </Button>}
    {(permission === 'default' || permission === 'granted') && <p className="browser-settings-page-description browser-notification-permission-hint">{hint}</p>}
    {native && <div className="browser-notification-permission-hint grid justify-items-start gap-2">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={background} disabled={saving} onChange={event => void changeBackground(event.currentTarget.checked)} />
        {backgroundLabel}
      </label>
      <p className="browser-settings-page-description">{backgroundDescription}</p>
      <Button type="button" variant="outline" size="sm" disabled={testDisabled} onClick={() => void sendTest()}>{testLabel}</Button>
      {deliveryMessage && <p className="browser-settings-page-description" role="status">{deliveryMessage}</p>}
    </div>}
  </section>
}
