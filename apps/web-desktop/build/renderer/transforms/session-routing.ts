import path from 'node:path'
import { replaceBrowserContract } from './contract'

/** The current explicit engine selection outranks historical rows with the same stored id. */
export function useBrowserSelectedSessionOwner(source: string): string {
  return replaceBrowserContract(source, [
    ['  $selectedStoredSessionId,\n  $sessions,\n  $unlistedSessionOwnerRows,', '  $selectedStoredSessionId,\n  $sessionResumeRequest,\n  $sessions,\n  $unlistedSessionOwnerRows,'],
    ['  const storedSessionId = storedSessionIdForRuntimeId(sessionId) ?? sessionId', `  const selectedRequest = $sessionResumeRequest.get()
  if (selectedRequest?.ownerRoute && selectedRequest.sessionId === $selectedStoredSessionId.get() &&
      (sessionId === selectedRequest.sessionId || (sessionId === $activeSessionId.get() &&
        $sessionStates.get()[sessionId]?.storedSessionId === selectedRequest.sessionId))) {
    return selectedRequest.ownerRoute
  }

  const storedSessionId = storedSessionIdForRuntimeId(sessionId) ?? sessionId`]
  ])
}

/** Athena multiplexes every profile over one socket, including its startup profile. */
export function useBrowserOwnedSessionRpc(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/platform/connection'))
  return `import { WEB_CONNECTION_ID } from ${owner}\n` + replaceBrowserContract(source, [
    ['    const routedParams = routeParams(ownerProfile, params)', `    const routedParams = connectionId === WEB_CONNECTION_ID
      ? { ...routeParams(ownerProfile, params), profile: ownerProfile.targetProfile || ownerProfile.profile }
      : routeParams(ownerProfile, params)`]
  ])
}

/** A copied row on another profile cannot borrow the selected runtime for rename. */
export function keepBrowserRenameProfile(source: string): string {
  return replaceBrowserContract(source, [
    ['  $selectedStoredSessionId,\n', '  $selectedStoredSessionId,\n  $sessionResumeRequest,\n'],
    ['      applySessionTitle(sessionId, finalTitle || null)', '      applySessionTitle(sessionId, finalTitle || null, targetProfile)'],
    ['      applyRenamedSessionTitle(sessionId, finalTitle || null)', '      applyRenamedSessionTitle(sessionId, finalTitle || null, targetProfile)'],
    ['  if (title && runtimeId && gateway) {', `  const request = $sessionResumeRequest.get()
  const selectedOwner = request?.sessionId === $selectedStoredSessionId.get() ? request.ownerRoute : undefined
  if (title && runtimeId && gateway && (!selectedOwner || !resolvedProfile || selectedOwner.profile === resolvedProfile)) {`]
  ])
}

/** Publish renamed titles to the matching profile in the engine's existing slices. */
export function scopeBrowserSessionTitles(source: string): string {
  return replaceBrowserContract(source, [
    ['export function applySessionTitle(storedSessionId: string | null | undefined, title: string | null): void {',
      'export function applySessionTitle(storedSessionId: string | null | undefined, title: string | null, profile?: string): void {'],
    ['      if (!sessionMatchesStoredId(session, id) || session.title === next) {',
      "      if (!sessionMatchesStoredId(session, id) || (profile && (session.profile?.trim() || 'default') !== (profile.trim() || 'default')) || session.title === next) {"]
  ])
}

/** Use the same profile on project previews and hydrated lanes. */
export function scopeBrowserProjectTitles(source: string): string {
  return replaceBrowserContract(source, [
    ['export function applyRenamedSessionTitle(sessionId: string, title: string | null): void {',
      'export function applyRenamedSessionTitle(sessionId: string, title: string | null, profile?: string): void {'],
    ['    const renamed = renameProjectSessions(project, sessionId, next)', '    const renamed = renameProjectSessions(project, sessionId, next, profile)'],
    ['  next: string | null\n): SidebarProjectTree {', '  next: string | null,\n  profile?: string\n): SidebarProjectTree {'],
    ['      if (!sessionMatchesStoredId(session, sessionId) || session.title === next) {',
      "      if (!sessionMatchesStoredId(session, sessionId) || (profile && (session.profile?.trim() || 'default') !== (profile.trim() || 'default')) || session.title === next) {"]
  ])
}
