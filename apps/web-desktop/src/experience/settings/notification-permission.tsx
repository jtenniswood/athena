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
    ? 'Browser permission is allowed. Enable notifications and Response ready below to receive alerts when a reply finishes in your current chat while you are away.'
    : permission === 'denied'
      ? 'Notifications are blocked. Allow notifications for Athena in your browser’s site settings, then return here.'
      : permission === 'insecure'
        ? 'Open Athena over HTTPS or localhost to enable browser notifications.'
        : permission === 'unsupported'
          ? 'Notifications are unavailable in this browser. On iPhone or iPad, add Athena to your Home Screen and open it there.'
          : 'Allow Athena to send browser notifications when a reply finishes while you are away.'

  const requestPermission = async () => {
    setRequesting(true)
    try {
      setPermission(await requestBrowserNotificationPermission())
    } finally {
      setRequesting(false)
    }
  }

  return <section className="browser-settings-page browser-notification-permission" aria-label="Browser notification permission">
    <h2 className="browser-settings-page-title">Browser notifications</h2>
    <p className="browser-settings-page-description" role="status">{description}</p>
    {permission === 'default' && <Button disabled={requesting} onClick={() => void requestPermission()} variant="outline">
      {requesting ? 'Waiting for permission…' : 'Allow browser notifications'}
    </Button>}
    <p className="browser-settings-page-description">Keep Athena open in a tab or installed app. Alerts pause if the browser suspends or closes Athena.</p>
  </section>
}
