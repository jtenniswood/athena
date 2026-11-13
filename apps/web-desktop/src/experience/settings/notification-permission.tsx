import { useEffect, useState } from 'react'
import { useStore } from '@nanostores/react'
import { $nativeNotifyPrefs } from '@/store/native-notifications'
import { Button } from '../../upstream/ui'
import { browserNotificationPermission, requestBrowserNotificationPermission } from '../../platform/notifications'
import { androidPushActive, isAndroidApp, refreshAndroidNotificationPermission } from '../../platform/android'
import { androidBackgroundAlerts, setAndroidBackgroundAlerts, testAndroidPush } from '../../platform/android-push'
import { browserPushEnabled, browserPushReady, browserPushSupported, prepareBrowserPush, setBrowserPushEnabled, testBrowserPush } from '../../platform/browser-push'
import { useSettingsPresentation } from './presentation'

export function BrowserNotificationPermissionSetting() {
  const native = isAndroidApp()
  const [permission, setPermission] = useState(browserNotificationPermission)
  const [requesting, setRequesting] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(androidPushActive)
  const [background, setBackground] = useState(() => native ? androidBackgroundAlerts() : browserPushEnabled())
  const [browserReady, setBrowserReady] = useState(false)
  const [browserWatching, setBrowserWatching] = useState(browserPushReady)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [deliveryMessage, setDeliveryMessage] = useState('')
  const alertsEnabled = useStore($nativeNotifyPrefs).enabled

  const changeBackground = async (enabled: boolean) => {
    setBackground(enabled)
    setSaving(true)
    setDeliveryMessage('')
    try {
      const updated = await (native ? setAndroidBackgroundAlerts(enabled) : setBrowserPushEnabled(enabled))
      if (enabled && !updated) setDeliveryMessage('Could not enable background delivery. Check your connection and try again.')
    } catch {
      setDeliveryMessage('Could not update background delivery. Check your connection and try again.')
    } finally {
      if (!native) setBackground(browserPushEnabled())
      setSaving(false)
    }
  }

  const sendTest = async () => {
    setTesting(true)
    setDeliveryMessage('')
    try {
      await (native ? testAndroidPush() : testBrowserPush())
      setDeliveryMessage(native ? 'Firebase accepted the test. Check your Android notifications.' : 'Test sent. Check your browser notifications.')
    } catch (error) {
      const response = error instanceof Error ? error.message.match(/^\d+: (.+)$/)?.[1] : undefined
      let message = native ? 'Could not send a push test. Check the Android push status in App settings.' : 'Could not send a browser push test.'
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
    const updateBrowser = () => { setBackground(browserPushEnabled()); setBrowserWatching(browserPushReady()) }
    const prepare = () => { void prepareBrowserPush().then(setBrowserReady) }
    refresh()
    if (!native && browserPushSupported()) {
      prepare()
      navigator.serviceWorker.addEventListener('controllerchange', prepare)
      void navigator.serviceWorker.ready.then(prepare)
      window.addEventListener('athena:browser-push', updateBrowser)
    }
    window.addEventListener('athena:notification-permission', update)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      if (!native && browserPushSupported()) {
        navigator.serviceWorker.removeEventListener('controllerchange', prepare)
        window.removeEventListener('athena:browser-push', updateBrowser)
      }
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
  const hint = (native ? pushEnabled : browserWatching)
    ? 'Reply alerts can arrive while Athena is closed.'
    : 'Turn on background delivery to receive reply alerts while Athena is closed.'
  const backgroundLabel = 'Background delivery on this device'
  const backgroundDescription = native ? 'Use Firebase for reply alerts while the app is closed.' : 'Use your browser’s push service for reply alerts.'
  const testLabel = testing ? 'Sending push test…' : native ? 'Send Android push test' : 'Send browser push test'
  const testDisabled = testing || saving || !background || !alertsEnabled || permission !== 'granted' || (!native && !browserWatching)
  const showDelivery = native || (browserReady && permission === 'granted')
  const presentation = useSettingsPresentation([
    { kind: 'heading', label: title }, { kind: 'text', label: description },
    ...(permission === 'default' ? [{ id: 'permission', kind: 'action' as const,
      label: requesting ? 'Waiting for permission…' : 'Allow notifications', disabled: requesting, run: requestPermission }] : []),
    ...((native || browserReady) && ['default', 'granted'].includes(permission) ? [{ kind: 'text' as const, label: hint }] : []),
    ...(showDelivery ? [
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
    {(native || browserReady) && (permission === 'default' || permission === 'granted') && <p className="browser-settings-page-description browser-notification-permission-hint">{hint}</p>}
    {showDelivery && <div className="browser-notification-permission-hint grid justify-items-start gap-2">
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
