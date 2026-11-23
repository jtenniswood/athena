import { Codicon } from '@/components/ui/codicon'
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { useI18n } from '@/i18n'
import { requestProfileCreate } from '@/store/profile'
import { runImportProfileFlow } from '@/store/profile-share'
import { setBrowserProfilesCombined } from './profile-section'

export function BrowserProfileLayoutMenu({ combined }: { combined: boolean }) {
  const { t } = useI18n()
  return <DropdownMenuSub>
    <DropdownMenuSubTrigger><Codicon name="organization" size="0.8125rem" />Profiles</DropdownMenuSubTrigger>
    <DropdownMenuSubContent>
      <DropdownMenuRadioGroup value={combined ? 'combined' : 'separate'} onValueChange={value => setBrowserProfilesCombined(value === 'combined')}>
        <DropdownMenuRadioItem value="combined" onSelect={event => event.preventDefault()}>Combined</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="separate" onSelect={event => event.preventDefault()}>Separate</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={requestProfileCreate}>
        <Codicon name="add" size="0.8125rem" />{t.profiles.newProfile}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void runImportProfileFlow()}>
        <Codicon name="cloud-download" size="0.8125rem" />{t.profiles.importProfile}
      </DropdownMenuItem>
    </DropdownMenuSubContent>
  </DropdownMenuSub>
}
