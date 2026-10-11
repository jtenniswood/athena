import { useStore } from '@nanostores/react'

import { $activeGatewayProfile } from '@/store/profile'
import { $gatewayState } from '@/store/session'
import { useBrowserApproval } from '../upstream/approval'
import { Button, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger, Tip, useI18n, Brain, Power, ShieldLock } from '../upstream/browser-api'
import { useBrowserGatewayRequest } from '../upstream/gateway-request'
import type { BrowserApprovalMode } from './contracts/actions'

function ApprovalModeIcon({ mode }: { mode: BrowserApprovalMode }) {
  if (mode === 'manual') return <ShieldLock className="size-3.5" />
  if (mode === 'smart') return <Brain className="size-3.5" />
  return <Power className="size-3.5" />
}

export function BrowserApprovalComposerControl() {
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const profile = useStore($activeGatewayProfile)
  const gatewayState = useStore($gatewayState)
  const requestGateway = useBrowserGatewayRequest()
  const { mode, setMode } = useBrowserApproval(profile, requestGateway)
  const labels: Record<BrowserApprovalMode, string> = { manual: copy.manual, smart: copy.smart, off: copy.off }
  const descriptions: Record<BrowserApprovalMode, string> = { manual: copy.manualDescription, smart: 'Ask when needed', off: copy.offDescription }

  if (gatewayState !== 'open') return null

  return (
    <div className="browser-approval-control">
    <DropdownMenu>
      <Tip label={copy.ariaLabel(labels[mode])} side="top">
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={copy.ariaLabel(labels[mode])}
            className="h-(--composer-control-size) shrink-0 gap-1 rounded-md px-2 text-xs font-normal text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground"
            data-browser-approval-control=""
            type="button"
            variant="ghost"
          >
            <ApprovalModeIcon mode={mode} />
            <span data-mode-name="">{labels[mode]}</span>
            <Codicon className="size-2.5 shrink-0 opacity-50" name="chevron-down" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-72 p-1" side="top" sideOffset={8}>
        <DropdownMenuLabel>{copy.title}</DropdownMenuLabel>
        <DropdownMenuRadioGroup onValueChange={value => void setMode(value as BrowserApprovalMode)} value={mode}>
          {(['manual', 'smart', 'off'] as const).map(value => (
            <DropdownMenuRadioItem className="items-start gap-2" key={value} value={value}>
              <ApprovalModeIcon mode={value} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs text-foreground">{labels[value]}</span>
                <span className="text-[0.6875rem] leading-snug text-(--ui-text-tertiary)">{descriptions[value]}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  )
}
