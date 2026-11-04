import { Brain, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, Power, ShieldLock, useI18n } from '../upstream/browser-api'
import type { Translations } from '../upstream/browser-api'
import type { BrowserApprovalMode } from './contracts/actions'

type ApprovalCopy = Translations['shell']['approvalMode']

export function browserApprovalChoices(copy: ApprovalCopy) {
  return {
    manual: { label: copy.manual, description: copy.manualDescription, Icon: ShieldLock },
    smart: { label: copy.smart, description: 'Ask when needed', Icon: Brain },
    off: { label: copy.off, description: copy.offDescription, Icon: Power }
  } satisfies Record<BrowserApprovalMode, { label: string; description: string; Icon: typeof ShieldLock }>
}

/** Both browser entry points present the same engine-owned choices and command. */
export function BrowserApprovalModeMenu({ mode, setMode }: {
  mode: BrowserApprovalMode
  setMode(mode: BrowserApprovalMode): Promise<void>
}) {
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const choices = browserApprovalChoices(copy)
  return <>
    <DropdownMenuLabel>{copy.title}</DropdownMenuLabel>
    <DropdownMenuRadioGroup onValueChange={value => void setMode(value as BrowserApprovalMode)} value={mode}>
      {Object.entries(choices).map(([value, { label, description, Icon }]) =>
        <DropdownMenuRadioItem className="items-start gap-2" key={value} value={value}>
          <Icon className="size-3.5" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-foreground">{label}</span>
            <span className="text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">{description}</span>
          </span>
        </DropdownMenuRadioItem>
      )}
    </DropdownMenuRadioGroup>
  </>
}
