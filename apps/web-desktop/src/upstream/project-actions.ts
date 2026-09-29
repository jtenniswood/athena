import { $projectTree, moveSessionToProject, projectRootCwd } from '@/store/projects'
import { notifyError } from '@/store/notifications'

/** Resolve only existing projects with a folder as eligible sidebar drop targets. */
export function browserDropProjectId(projectId: string | undefined): string | null {
  if (!projectId) return null
  const project = $projectTree.get().find(item => item.id === projectId)
  return project && projectRootCwd(project) ? project.id : null
}

export function moveBrowserSessionToProject(sessionId: string, projectId: string, profile: string): Promise<void> {
  return moveSessionToProject(sessionId, projectId, profile)
}

export function reportBrowserProjectMoveFailure(error: unknown): void {
  notifyError(error, 'Could not move chat to project')
}
