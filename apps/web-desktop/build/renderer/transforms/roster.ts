import path from 'node:path'
import { replaceBrowserContract } from './contract'

export function useBrowserRosterDialogFocus(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/dialog-focus'))
  const targets = [
    ['export function GroupDialog({ bot, onClose }: GroupDialogProps) {', 'true', '      <DialogContent className="max-w-sm">', '      <DialogContent className="max-w-sm" data-browser-bot-dialog="section" onCloseAutoFocus={browserReturnFocus}>'],
    ['export function EditProfileDialog({ bot, open, onClose }: EditProfileDialogProps) {', 'open', '      <DialogContent\n', '      <DialogContent\n        data-browser-bot-dialog={advanced ? \'advanced\' : \'section\'}\n        onCloseAutoFocus={browserReturnFocus}\n'],
    ['}: ConfirmDialogProps) {', 'open', '      <DialogContent\n', '      <DialogContent\n        data-browser-bot-dialog="confirm"\n        onCloseAutoFocus={browserReturnFocus}\n']
  ]
  const target = targets.find(([start]) => source.includes(start))
  if (!target) throw new Error('Browser roster dialog boundary changed')
  const [start, open, before, after] = target
  if (source.split(start).length !== 2 || source.split(before).length !== 2) throw new Error('Browser roster dialog focus target changed')
  source = source.replace(start, start + `\n  const browserReturnFocus = useBrowserDialogReturnFocus(${open})`).replace(before, after)
  return source.includes('import { useBrowserDialogReturnFocus }') ? source : `import { useBrowserDialogReturnFocus } from ${owner}\n` + source
}

export function useBrowserBotDialogFocus(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/dialog-focus'))
  const changes = [
    ['export function CreateAgentDialog({ open, onClose, onConfigureModel, roster }: CreateAgentDialogProps) {', 'export function CreateAgentDialog({ open, onClose, onConfigureModel, roster }: CreateAgentDialogProps) {\n  const browserReturnFocus = useBrowserDialogReturnFocus(open)'],
    ['export function CreateGroupChatDialog({ open, roster, onClose, onCreated }: CreateGroupChatDialogProps) {', 'export function CreateGroupChatDialog({ open, roster, onClose, onCreated }: CreateGroupChatDialogProps) {\n  const browserReturnFocus = useBrowserDialogReturnFocus(open)'],
    ['      <DialogContent\n', '      <DialogContent\n        data-browser-bot-dialog={advanced ? \'advanced\' : \'create\'}\n        onCloseAutoFocus={browserReturnFocus}\n'],
    ['      <DialogContent className="max-w-md">', '      <DialogContent className="max-w-md" data-browser-bot-dialog="group" onCloseAutoFocus={browserReturnFocus}>']
  ]
  for (const [before, after] of changes) {
    if (source.split(before).length !== 2) throw new Error('Browser Bot dialog focus boundary changed')
    source = source.replace(before, after)
  }
  return `import { useBrowserDialogReturnFocus } from ${owner}\n` + source
}

export function useBrowserSectionDialogFocus(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/dialog-focus'))
  const start = 'export function SectionNameDialog({ initialName, mode, onOpenChange, onSubmit, open }: SectionNameDialogProps) {'
  const content = '      <DialogContent className="max-w-sm">'
  if (source.split(start).length !== 2 || source.split(content).length !== 2) throw new Error('Browser section dialog focus boundary changed')
  return `import { useBrowserDialogReturnFocus } from ${owner}\n` + source
    .replace(start, start + '\n  const browserReturnFocus = useBrowserDialogReturnFocus(open)')
    .replace(content, '      <DialogContent className="max-w-sm" data-browser-bot-dialog="section" onCloseAutoFocus={browserReturnFocus}>')
}

export function useBrowserRosterActionSurfaces(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/browser-roster-actions'))
  const start = '  return (\n    <ContextMenu>'
  const end = '    </ContextMenu>\n  )'
  const replacements = [
    '  return <BrowserBotRowActions bot={bot} row={row} onDelete={onDelete} onEdit={onEdit} onGroup={onGroup} onNewSection={onNewSection} />',
    '  return <BrowserGroupRowActions name={group} deleteLabel={b.group.deleteAction} row={row} onOpen={() => onOpen(group)} onDelete={() => onDisband({ name: group, members })} />'
  ]
  if (source.split(start).length !== 3 || source.split(end).length !== 3) throw new Error('Browser roster action boundary changed')
  for (const replacement of replacements) {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from) + end.length
    source = source.slice(0, from) + replacement + source.slice(to)
  }
  return `import { BrowserBotRowActions, BrowserGroupRowActions } from ${owner}\n` + source
}

export function useBrowserSectionActionSurface(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/browser-roster-actions'))
  const start = '}: UserSectionHeaderProps) {'
  const end = '\n// ── drop zone'
  if (source.split(start).length !== 2 || source.split(end).length !== 2) throw new Error('Browser section action boundary changed')
  const from = source.indexOf(start) + start.length
  const to = source.indexOf(end, from)
  return `import { BrowserBotSectionHeader } from ${owner}\n` + source.slice(0, from) + '\n  return <BrowserBotSectionHeader {...{ canMoveDown, canMoveUp, collapsed, count, id, name, onDelete, onMove, onRename, onToggle }} />\n}\n' + source.slice(to)
}

export function removeBrowserNewBotChatAction(source: string): string {
  if (!source.includes('b.bot.newChatWith')) return source
  const invocation = 'newBotChat(bot)'
  const start = source.lastIndexOf('<ContextMenuItem', source.indexOf(invocation))
  const close = source.indexOf('</ContextMenuItem>', source.indexOf(invocation))
  const end = close < 0 ? -1 : close + '</ContextMenuItem>'.length
  const action = start < 0 || end < 0 ? '' : source.slice(start, end)
  const imports = ["  saveSelectedRosterBot\n", "  newBotChat,\n"]
  if (!action || source.indexOf(invocation) !== source.lastIndexOf(invocation) || imports.some(target => source.split(target).length !== 2)) {
    throw new Error('Browser new-bot-chat action target changed')
  }
  let output = source.replace(action, '')
  output = output.replace(imports[0], '').replace(imports[1], '')
  output = output.replace("import { botRosterMeta, botWorkspaceOwnerKey, setBotsWorkspaceOwner } from './routing'", "import { botRosterMeta } from './routing'")
  return output
}

export function removeBrowserGatewayGroupsRefresh(source: string, root: string): string {
  const changes: [string, string][] = [
    ['  const profile = useValue(host.state.profile)\n', `  const profile = useValue(host.state.profile)
  const gatewayState = useValue(host.state.gateway)
  const gateway = useValue($gateway)
`],
    ['  const [refresh, setRefresh] = useState(0)\n', '  const [refresh, finishRefresh] = useBotsRefreshSignal()\n'],
    ["    setError('')\n", `    setError('')
    // The open state may publish before the socket. Retry when both are ready.
    if (gatewayState !== 'open' || !gateway) {
      finishRefresh()
      return
    }
`],
    ['[connectionId, profile, refresh, revision]', '[connectionId, profile, gatewayState, gateway, refresh, revision, finishRefresh]'],
    ["})().catch(e => { if (!cancelled) {setError(e instanceof Error ? e.message : String(e))} })", "})().catch(e => { if (!cancelled) {setError(e instanceof Error ? e.message : String(e))} }).finally(finishRefresh)"],
    ['    <Button onClick={() => setRefresh(value => value + 1)} variant="ghost">{labels.refreshGroups}</Button>\n', '']
  ]
  for (const [before] of changes) {
    if (source.split(before).length !== 2) throw new Error('Browser gateway groups refresh target changed')
  }
  return `import { $gateway } from '@/store/gateway'\nimport { useBotsRefreshSignal } from ${JSON.stringify(path.join(root, 'src/experience/browser-bots-refresh'))}\n` +
    changes.reduce((output, [before, after]) => output.replace(before, after), source)
}

export function useBrowserBotsPullRefresh(source: string, root: string): string {
  const opening = '    <div className="flex h-full flex-col">'
  const end = source.lastIndexOf('    </div>')
  if (source.split(opening).length !== 2 || end < source.indexOf(opening)) throw new Error('Browser Bots refresh owner changed')
  const output = source.slice(0, end) + '    </BrowserBotsRefresh>' + source.slice(end + '    </div>'.length)
  return `import { BrowserBotsRefresh } from ${JSON.stringify(path.join(root, 'src/experience/browser-bots-refresh'))}\n` +
    output.replace(opening, '    <BrowserBotsRefresh refreshRoster={refetch}>')
}

export function removeBrowserOpenBotChatAction(source: string): string {
  const action = '<ContextMenuItem onSelect={() => void openRosterBot(bot)}>{b.bot.openBotChat}</ContextMenuItem>'
  if (!source.includes('b.bot.openBotChat')) return source
  if (source.split(action).length !== 2) throw new Error('Browser open-bot-chat action target changed')
  const tabAction = `<ContextMenuItem onSelect={() => void openRosterBot(bot, { intent: 'tab' })}>{b.bot.openBotChatInNewTab}</ContextMenuItem>`
  if (source.split(tabAction).length !== 2) throw new Error('Browser bot tab action target changed')
  return source.replace(action, '').replace(tabAction, '')
}

export function showHiddenBotsInBrowserRoster(source: string): string {
  if (source.includes('$showHiddenBots.get()')) return source

  const importTarget = "import { isBotHidden } from './hidden-bots'\n"
  const hiddenTarget = '  const hiddenBots = roster.filter(bot => isBotHidden(bot, allMeta))\n  const visibleRoster = roster.filter(bot => !isBotHidden(bot, allMeta))'
  if (source.split(importTarget).length !== 2 || source.split(hiddenTarget).length !== 2) {
    throw new Error('Browser hidden bot roster target changed')
  }

  return source
    .replace(importTarget, importTarget + "import { $showHiddenBots } from './hidden-bots'\n")
    .replace(hiddenTarget, `  const showHiddenBots = $showHiddenBots.get()
  const hiddenBots: RosterRow[] = []
  const visibleRoster = showHiddenBots ? roster : roster.filter(bot => !isBotHidden(bot, allMeta))`)
}

export function useBrowserRosterSelection(source: string, root: string, surface: 'bot' | 'group' | 'created-group'): string {
  const replacements: Record<typeof surface, [string, string][]> = {
    bot: [
      ["import { openRosterBot } from './roster-actions'", ''],
      ["const open = (event?: { ctrlKey?: boolean; metaKey?: boolean }) =>\n    void openRosterBot(bot, { intent: event?.metaKey || event?.ctrlKey ? 'tab' : 'in-place' })", 'const open = () => void selectBrowserBot(botSelectionKey(bot))']
    ],
    group: [
      ["import { GroupChatWorkspace, openGroupChat } from './group-chat-view'", "import { GroupChatWorkspace } from './group-chat-view'"],
      ['onOpen={openGroupChat}', 'onOpen={selectBrowserGroup}'],
      ["onOpen={group => openGroupChat(group, 'name')}", "onOpen={group => selectBrowserGroup(group, 'name')}"]
    ],
    'created-group': [
      ["import { disbandGroupChat, openGroupChat } from './group-chat-view'", "import { disbandGroupChat } from './group-chat-view'"],
      ['onCreated={(group, origin) => openGroupChat(group, origin)}', 'onCreated={selectBrowserGroup}']
    ]
  }
  let output = source
  for (const [target, replacement] of replacements[surface]) {
    if (output.split(target).length !== 2) throw new Error(`Browser ${surface} selection target changed`)
    output = output.replace(target, replacement)
  }
  const command = surface === 'bot' ? 'selectBrowserBot' : 'selectBrowserGroup'
  return `import { ${command} } from ${JSON.stringify(path.join(root, 'src/upstream/roster-selection.ts'))}\n` + output
}
