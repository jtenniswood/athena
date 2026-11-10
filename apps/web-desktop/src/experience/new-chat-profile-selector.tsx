import { useBrowserEngine } from './engine'
import { BotFace, avatarColor, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../upstream/browser-api'
import { BrowserToolbarButton } from './ui/toolbar-button'

export function BrowserNewChatProfileSelector({ iconOnly }: { iconOnly: boolean }) {
  const engine = useBrowserEngine()
  const draft = engine.profiles.useNewChat()
  const profiles = engine.profiles.useProfiles()
  if (!draft.editable || profiles.items.length === 0) return null
  const selected = profiles.items.find(item => item.key === draft.profile) || profiles.fallback
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <BrowserToolbarButton className={iconOnly ? undefined : 'browser-new-chat-profile'} aria-label={`Chat profile: ${selected?.label || draft.profile}`} tooltip="Choose a profile for this chat">
        {selected ? <BotFace color={avatarColor(selected.appearance.color, selected.botName)} name={selected.botName} image={selected.appearance.image} shape={selected.appearance.shape} size={20} />
          : iconOnly && <Codicon name="account" />}
        {!iconOnly && <>
          <span>{selected?.label || draft.profile}</span>
          <Codicon name="chevron-down" />
        </>}
      </BrowserToolbarButton>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64 p-1">
      <DropdownMenuLabel>Profile for this chat</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={draft.profile} onValueChange={draft.select}>
        {profiles.items.map(item => <DropdownMenuRadioItem key={item.key} value={item.key}>
          <BotFace color={avatarColor(item.appearance.color, item.botName)} name={item.botName} image={item.appearance.image} shape={item.appearance.shape} size={20} />
          <span className="truncate">{item.label}</span>
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
