import { $sidebarProfileFilter, setSidebarGrouping } from '@/store/layout'

const UNIFIED_LIST_KEY = 'hermes-web.browser.unified-session-list.v1'

/** Start existing installations with profile sections in one list, then preserve later view choices. */
export function restoreUnifiedSessionList(): void {
  try {
    if (localStorage.getItem(UNIFIED_LIST_KEY) === 'true') return
    setSidebarGrouping('profile')
    $sidebarProfileFilter.set([])
    localStorage.setItem(UNIFIED_LIST_KEY, 'true')
  } catch { /* The unified profile scope also works without browser storage. */ }
}
