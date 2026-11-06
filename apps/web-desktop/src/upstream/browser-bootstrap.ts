import { readBrowserTabProfile } from '../platform/tab-profile'

/** Restore the selected profile before upstream startup reads its connection. */
export function prepareBrowserBridge(): void {
  const profile = readBrowserTabProfile()
  if (!profile) return
  window.__HERMES_WEB_ACTIVE_PROFILE__ = profile
  const bridge = window.hermesDesktop
  const getConnection = bridge.getConnection.bind(bridge)
  bridge.getConnection = requested => getConnection(requested ?? profile)
  bridge.profile.get = async () => ({ profile })
}
