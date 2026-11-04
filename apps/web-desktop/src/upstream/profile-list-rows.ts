import type { SessionInfo } from '@/hermes'
import { flattenSessionsWithBranches } from '@/lib/session-branch-tree'
import { groupEntriesByRecency, groupEntriesByStatus, toSessionRows, type SidebarListRow } from '@/lib/session-date-groups'
import { hasLiveTurn, type SessionDotState } from '@/store/session-dot-state'

/** Scope disclosure keys by exact owner so collapsing one profile never folds another. */
export function browserProfileListRows(sessions: SessionInfo[], grouping: 'date' | 'status' | 'none',
  states: Record<string, SessionDotState>, labels: { done: string; working: string }): SidebarListRow[] {
  const entries = flattenSessionsWithBranches(sessions)
  const rows = grouping === 'date' ? groupEntriesByRecency(entries)
    : grouping === 'status' ? groupEntriesByStatus(entries, entry => hasLiveTurn(states[entry.session.id] ?? 'idle'), labels)
    : toSessionRows(entries)
  const owner = JSON.stringify([sessions[0]?.connection_id, sessions[0]?.profile])
  return rows.map(row => row.kind === 'divider' ? { ...row, key: owner + ':' + row.key } : row)
}
