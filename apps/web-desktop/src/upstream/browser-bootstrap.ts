import { readBrowserTabProfile } from '../platform/tab-profile'

/** Restore the selected profile before upstream startup reads its connection. */
export function prepareBrowserBridge(): void {
  const profile = readBrowserTabProfile()
  if (!profile) return
  const bridge = window.hermesDesktop
  const getConnection = bridge.getConnection.bind(bridge)
  bridge.getConnection = requested => getConnection(requested ?? profile)
  bridge.profile.get = async () => ({ profile })
}
