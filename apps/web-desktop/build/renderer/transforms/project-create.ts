import { replaceBrowserContract } from './contract'

/** Capture the destination at dialog open and use the engine's existing context guards. */
export function useBrowserProjectCreateOwner(source: string): string {
  return replaceBrowserContract(source, [
    ['export interface CreateProjectInput {', 'export interface CreateProjectInput {\n  profile?: string'],
    ['    context = await activeProjectsContext(writableProjectProfile())',
      '    context = await activeProjectsContext(input.profile ?? writableProjectProfile())'],
    ['export interface ProjectDialogState {', 'export interface ProjectDialogState {\n  profile?: string'],
    ["  $projectDialog.set({ mode: 'create' })", "  $projectDialog.set({ mode: 'create', profile: writableProjectProfile() })"]
  ])
}

export function useBrowserProjectDialogOwner(source: string): string {
  return replaceBrowserContract(source, [
    ['        const created = await createProject({', '        const created = await createProject({\n          profile: state?.profile,'],
    ['<DialogTitle>{title}</DialogTitle>', "<DialogTitle>{title}{mode === 'create' && state?.profile ? ` · ${state.profile}` : ''}</DialogTitle>"]
  ])
}
