import type { ReactNode } from 'react'
import { startNewSessionDrag, type NewSessionSplitHandler, type NewSessionPlacement } from '@/app/chat/new-session-drag'
import type { SidebarSessionGroup } from '@/app/chat/sidebar/projects/workspace-groups'
import { WorkspaceContextMenu, WorkspaceMenu } from '@/app/chat/sidebar/projects/workspace-header'
import { ProfileGlyph } from '@/components/ui/profile-glyph'
import { useI18n } from '@/i18n'
import { displayPath } from '@/lib/display-path'
import { selectProfile } from '@/store/profile'
import { BrowserProfileHeader, BrowserTreeAdd, BrowserTreeBody, BrowserTreeHeader, BrowserTreeStack } from '../experience/sidebar-tree'
import { useBrowserSidebarFigures } from './sidebar-profile'

interface WorkspaceController {
  group: SidebarSessionGroup & { browserProject?: boolean }
  isProfileGroup: boolean
  usage?: { tokens: number; cost_usd: number }
  open: boolean
  toggleOpen(): void
  empty: boolean
  rows: ReactNode
  canCreate: boolean
  handleNewSession(): Promise<void>
  handleNewSessionSplit(placement: NewSessionPlacement): Promise<void>
  onNewSessionSplit?: NewSessionSplitHandler
  onRemove?(): void
}

export function BrowserWorkspaceControllerSurface({ model }: { model: WorkspaceController }) {
  const { t } = useI18n(), s = t.sidebar, { group } = model
  const figures = useBrowserSidebarFigures({ tokens: model.usage?.tokens ?? 0, costUsd: model.usage?.cost_usd ?? 0 })
  const create = model.canCreate && <BrowserTreeAdd label={s.newSessionIn(group.label)} onClick={() => void model.handleNewSession()}
    onPointerDown={model.onNewSessionSplit ? event => startNewSessionDrag(placement => void model.handleNewSessionSplit(placement), event, {
      cwd: group.path, label: s.newSessionIn(group.label), profile: model.isProfileGroup ? group.id : undefined
    }) : undefined} />
  return <BrowserTreeStack>
    {model.isProfileGroup ? <BrowserProfileHeader model={{ label: group.label, labelAria: t.profiles.switchToProfile(group.label),
      labelClassName: 'capitalize hover:text-foreground hover:underline', activate: () => selectProfile(group.id), toggle: model.toggleOpen,
      toggleLabel: s.projects.toggle(group.label, !model.open), open: model.open, figures, actions: create,
      icon: <ProfileGlyph className="size-full" color={group.color ?? null} isDefault={group.id === 'default'} name={group.label} /> }} /> :
      <WorkspaceContextMenu onRemove={model.onRemove} path={group.path}>
        <BrowserTreeHeader model={{ label: group.label, title: group.path ? displayPath(group.path) : undefined,
          toggle: model.toggleOpen, open: model.open, project: group.browserProject,
          icon: <i aria-hidden="true" className={`codicon codicon-${group.browserProject ? model.open ? 'folder-opened' : 'folder' : group.isKanban ? 'checklist' : group.isHome ? 'home' : 'git-branch'} shrink-0 text-(--ui-text-tertiary)`} style={{ fontSize: '0.75rem' }} />,
          actions: (model.canCreate || model.onRemove) && <div className="flex items-center">{create}{model.onRemove && <WorkspaceMenu onRemove={model.onRemove} path={group.path} />}</div> }} />
      </WorkspaceContextMenu>}
    {model.open && <BrowserTreeBody empty={model.empty} emptyLabel={s.noSessions}>
      {model.rows}
    </BrowserTreeBody>}
  </BrowserTreeStack>
}
