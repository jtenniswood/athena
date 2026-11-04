import { arrayMove } from '@dnd-kit/sortable'
import { compactNumber } from '@hermes/shared'
import { useStore } from '@nanostores/react'
import type { ReactNode } from 'react'
import { startNewProjectDrag, startNewSessionDrag, type NewSessionSplitHandler } from '@/app/chat/new-session-drag'
import { renameGatewayGroup, reorderGatewayGroups, toggleGatewayGroup } from '@/app/chat/sidebar/gateway-group-preferences'
import { ReorderableList, useSortableBindings } from '@/app/chat/sidebar/reorderable-list'
import type { SidebarSessionGroup } from '@/app/chat/sidebar/projects/workspace-groups'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ProfileGlyph } from '@/components/ui/profile-glyph'
import { useI18n } from '@/i18n'
import { $sidebarGrouping, $sidebarRowMeta } from '@/store/layout'
import { $newProjectDropPlacement } from '@/store/projects'
import { BrowserProfileGroup, BrowserProfileNesting } from '../experience/sidebar-profile'
import { BrowserHideProfileItem } from '../experience/profile-list-visibility'
import { useBrowserProfileSection } from './profile-section'
import { openBrowserProfileProjectCreate } from './project-create'

export function useBrowserSidebarFigures(totals?: { tokens: number; costUsd: number }) {
  const meta = useStore($sidebarRowMeta)
  return [totals && meta.includes('tokens') && totals.tokens > 0 ? compactNumber(totals.tokens) : null,
    totals && meta.includes('cost') && totals.costUsd >= 0.01 ? `$${totals.costUsd.toFixed(2)}` : null].filter(Boolean).join(' · ')
}

interface ProfileGroupsController {
  ids: string[]
  ordered: SidebarSessionGroup[]
  gatewayProfiles: Map<string, SidebarSessionGroup[]>
  sensors?: Parameters<typeof ReorderableList>[0]['sensors']
}

/** Hermes owns group ordering and routes; Athena owns nesting and headers. */
export function BrowserProfileGroupsControllerSurface({ model, renderGroup, renderNested }: {
  model: ProfileGroupsController
  renderGroup(group: SidebarSessionGroup, index: number, move: (direction: 1 | -1) => void, children: ReactNode): ReactNode
  renderNested(groups: SidebarSessionGroup[]): ReactNode
}) {
  return <ReorderableList ids={model.ids} onReorder={reorderGatewayGroups} sensors={model.sensors}>
    {model.ordered.map((group, index) => renderGroup(group, index,
      direction => reorderGatewayGroups(arrayMove(model.ids, index, index + direction)),
      model.gatewayProfiles.has(group.id) ? <BrowserProfileNesting>{renderNested(model.gatewayProfiles.get(group.id)!)}</BrowserProfileNesting> : null))}
  </ReorderableList>
}

interface ProfileGroupController {
  group: SidebarSessionGroup
  label: string
  open: boolean
  embedded: boolean
  first: boolean
  last: boolean
  alias?: string
  sortable: ReturnType<typeof useSortableBindings>
  usage?: { tokens: number; cost_usd: number }
  renaming: boolean
  setRenaming(next: boolean): void
  draft: string
  setDraft(next: string): void
  onMove(direction: 1 | -1): void
  startSession(): void
  onNewSessionSplit?: NewSessionSplitHandler
  route?: { connectionId: string; profile: string }
  empty: boolean
  rows: ReactNode
  contribution: ReactNode
  children: ReactNode
}

export function BrowserProfileGroupControllerSurface({ model }: { model: ProfileGroupController }) {
  const { t } = useI18n(), s = t.sidebar, copy = s.gatewayGroups
  const { group, sortable } = model
  const grouping = useStore($sidebarGrouping)
  const renameLabel = group.profile ? 'Rename profile' : copy.rename
  const browserProfile = useBrowserProfileSection(group.profile)
  const label = model.alias || browserProfile?.label || model.label
  const figures = useBrowserSidebarFigures(model.usage ? { tokens: model.usage.tokens, costUsd: model.usage.cost_usd } : undefined)
  const toggle = () => toggleGatewayGroup(group.id)
  const actions = <div className="flex items-center">
    {browserProfile && group.profile && !model.embedded && grouping === 'project' && <Button
      aria-label={`${s.projects.newButton} in ${label}`} title={`${s.projects.newButton} in ${label}`} size="icon-xs" variant="ghost"
      onClick={() => void openBrowserProfileProjectCreate(group.profile!, model.route)}
      onPointerDown={event => startNewProjectDrag(placement => $newProjectDropPlacement.set(placement), event,
        { onTap: () => void openBrowserProfileProjectCreate(group.profile!, model.route) })}>
      <Codicon name="new-folder" size="0.75rem" />
    </Button>}
    {group.profile && !model.embedded && grouping !== 'project' && <Button aria-label={s.newSessionIn(label)} title={s.newSessionIn(label)} size="icon-xs" variant="ghost"
      onClick={model.startSession} onPointerDown={model.onNewSessionSplit ? event => startNewSessionDrag(placement => {
        if (!model.open) toggle()
        model.onNewSessionSplit?.(placement.dir, { anchor: placement.anchor, before: placement.before, profile: group.profile, route: model.route })
      }, event, { label: s.newSessionIn(label), profile: group.profile, route: model.route }) : undefined}>
      <Codicon name="add" size="0.75rem" />
    </Button>}
    <DropdownMenu><DropdownMenuTrigger asChild><Button aria-label={`${copy.actions}: ${label}`} size="icon-xs" variant="ghost"><Codicon name="ellipsis" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {browserProfile && group.profile && !model.embedded && <BrowserHideProfileItem profile={group.profile} />}
        <DropdownMenuItem onSelect={() => { model.setDraft(model.alias || ''); model.setRenaming(true) }}>{renameLabel}</DropdownMenuItem>
        <DropdownMenuItem disabled={model.first} onSelect={() => model.onMove(-1)}>{copy.moveUp}</DropdownMenuItem>
        <DropdownMenuItem disabled={model.last} onSelect={() => model.onMove(1)}>{copy.moveDown}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
  const dialog = <Dialog onOpenChange={model.setRenaming} open={model.renaming}><DialogContent>
    <form className="grid gap-4" onSubmit={event => { event.preventDefault(); renameGatewayGroup(group.id, model.draft); model.setRenaming(false) }}>
      <DialogHeader><DialogTitle>{renameLabel}</DialogTitle><DialogDescription>{copy.aliasHint}</DialogDescription></DialogHeader>
      <Input aria-label={copy.aliasLabel} autoFocus maxLength={120} onChange={event => model.setDraft(event.target.value)} placeholder={group.label} value={model.draft} />
      <DialogFooter>
        <Button className="sm:mr-auto" disabled={!model.alias} onClick={() => { renameGatewayGroup(group.id, ''); model.setRenaming(false) }} type="button" variant="outline">{copy.resetName}</Button>
        <Button onClick={() => model.setRenaming(false)} type="button" variant="ghost">{t.common.cancel}</Button>
        <Button type="submit">{t.common.save}</Button>
      </DialogFooter>
    </form>
  </DialogContent></Dialog>
  return <BrowserProfileGroup ref={sortable.ref} style={sortable.style}
    data-gateway-group={group.profile ? group.id : undefined} data-gateway-section={!group.profile ? group.id : undefined}
    empty={Boolean(group.profile) && model.empty} emptyLabel={s.noSessions} dialog={dialog}
    model={{ label, open: model.open, toggle, activate: toggle, toggleLabel: s.projects.toggle(label, !model.open), figures, actions,
      reorder: { label: `${copy.reorder}: ${label}`, dragging: sortable.dragging, bindings: sortable.dragHandleProps },
      icon: group.profile ? browserProfile?.picture ?? <ProfileGlyph className="size-full" color={group.color ?? null} isDefault={group.profile === 'default'} name={group.profile} /> : <Codicon name="remote" /> }}>
    {model.children}{model.contribution}{model.rows}
  </BrowserProfileGroup>
}
