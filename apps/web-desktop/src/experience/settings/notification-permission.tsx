import { useEffect, useState } from 'react'
import { Button } from '../../upstream/ui'
import { browserNotificationPermission, requestBrowserNotificationPermission } from '../../platform/notifications'

export function BrowserNotificationPermissionSetting() {
  const [permission, setPermission] = useState(browserNotificationPermission)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    const refresh = () => setPermission(browserNotificationPermission())
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  const description = permission === 'granted'
    ? 'Permission allowed. Choose your alerts below.'
    : permission === 'denied'
      ? 'Blocked by your browser. Allow notifications in Athena’s site settings.'
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

  return <section className="browser-notification-permission" aria-label="Browser notification permission">
    <div className="browser-notification-permission-copy">
      <h3 className="browser-settings-page-title">Browser notifications</h3>
      <p className="browser-settings-page-description" role="status">{description}</p>
    </div>
    {permission === 'default' && <Button disabled={requesting} aria-busy={requesting} onClick={() => void requestPermission()} type="button">
      {requesting ? 'Waiting for permission…' : 'Allow notifications'}
    </Button>}
    {(permission === 'default' || permission === 'granted') && <p className="browser-settings-page-description browser-notification-permission-hint">Alerts pause when Athena is closed or suspended.</p>}
  </section>
}
