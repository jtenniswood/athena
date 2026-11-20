import { useStore } from '@nanostores/react'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { $sidebarGrouping, $sidebarShowArchived, setSidebarGrouping, setSidebarShowArchived } from '@/store/layout'
import { restoreProfileGroups, useHiddenProfileGroups } from '../experience/profile-list-visibility'
import { browserArchivedLabel, useBrowserArchivedShortcut } from '../experience/sidebar-shortcuts'

export function SidebarFilterMenu({ className }: { className?: string }) {
  const { t: { sidebar: { filter } } } = useI18n()
  const grouping = useStore($sidebarGrouping)
  const archived = useStore($sidebarShowArchived)
  const hiddenProfiles = useHiddenProfileGroups()
  const toggleArchived = () => setSidebarShowArchived(!archived)
  useBrowserArchivedShortcut(toggleArchived)

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button aria-label={filter.filters} size="icon-xs" type="button" variant="ghost"
        className={cn(className, 'data-[state=open]:bg-(--ui-control-active-background) data-[state=open]:text-foreground data-[state=open]:opacity-100',
          archived && 'bg-(--ui-control-active-background) text-foreground opacity-100')}>
        <Codicon name="list-filter" size="0.75rem" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="min-w-52">
      <DropdownMenuSub>
        <DropdownMenuSubTrigger><Codicon name="list-tree" size="0.8125rem" />{filter.grouping}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={grouping} onValueChange={value => setSidebarGrouping(value === 'project' ? 'project' : 'none')}>
            <DropdownMenuRadioItem value="none" onSelect={event => event.preventDefault()}>
              <Codicon name="list-unordered" size="0.8125rem" />None
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="project" onSelect={event => event.preventDefault()}>
              <Codicon name="root-folder" size="0.8125rem" />{filter.project}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuCheckboxItem checked={archived} onSelect={event => { event.preventDefault(); toggleArchived() }}>
        <Codicon name="archive" size="0.8125rem" />{browserArchivedLabel(filter.archived)}
      </DropdownMenuCheckboxItem>
      {hiddenProfiles.length > 0 && <DropdownMenuItem onSelect={restoreProfileGroups}>
        <Codicon name="eye" size="0.8125rem" />Restore hidden profiles
      </DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>
}
