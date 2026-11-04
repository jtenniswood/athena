import { orderByIds } from '@/app/chat/sidebar/order'
import { sessionRecency } from '@/app/chat/sidebar/projects/workspace-groups'
import { $sidebarSessionOrderManual, setSidebarOrdering, setSidebarSessionOrderIds, type SidebarOrdering } from '@/store/layout'
import { $sessions } from '@/store/session'
import { $sidebarSessionRankIds } from '@/store/sidebar-sort'

export function setBrowserSidebarOrdering(ordering: SidebarOrdering): void {
  if (ordering === 'manual' && !$sidebarSessionOrderManual.get()) {
    // Capture the active ranking before Manual clears the computed sort ids.
    const recent = [...$sessions.get()].sort((a, b) => sessionRecency(b) - sessionRecency(a))
    const ordered = orderByIds(recent, session => session.id, $sidebarSessionRankIds.get())
    setSidebarSessionOrderIds(ordered.map(session => session.id))
  }
  setSidebarOrdering(ordering)
}
