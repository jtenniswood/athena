import { Codicon } from '@/components/ui/codicon'
import { DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu'
import { setBrowserProfilesCombined } from './profile-section'

export function BrowserProfileLayoutMenu({ combined }: { combined: boolean }) {
  return <DropdownMenuSub>
    <DropdownMenuSubTrigger><Codicon name="organization" size="0.8125rem" />Profiles</DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
      <DropdownMenuRadioGroup value={combined ? 'combined' : 'separate'} onValueChange={value => setBrowserProfilesCombined(value === 'combined')}>
        <DropdownMenuRadioItem value="combined" onSelect={event => event.preventDefault()}>Combined</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="separate" onSelect={event => event.preventDefault()}>Separate</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuSubContent>
  </DropdownMenuSub>
}
