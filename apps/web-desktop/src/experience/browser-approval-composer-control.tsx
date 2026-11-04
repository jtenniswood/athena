import { useBrowserEngine } from './engine'
import { Button, Codicon, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Tip, useI18n, ShieldLock } from '../upstream/browser-api'
import { BrowserApprovalModeMenu, browserApprovalChoices } from './approval-mode-menu'

export function BrowserApprovalComposerControl() {
  const engine = useBrowserEngine()
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const profile = engine.profiles.useActive()
  const requestGateway = engine.approval.useRequest()
  const { mode, setMode, ready } = engine.approval.useMode(profile, requestGateway)
  const label = browserApprovalChoices(copy)[mode].label

  if (!ready) return null

  return (
    <div className="browser-approval-control">
    <DropdownMenu>
      <Tip label={copy.ariaLabel(label)} side="top">
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={copy.ariaLabel(label)}
            className="h-(--composer-control-size) shrink-0 gap-1 rounded-md px-2 text-xs font-normal text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground"
            data-browser-approval-control=""
            type="button"
            variant="ghost"
          >
            <ShieldLock className="size-3.5" />
            <span data-mode-name="">{label}</span>
            <Codicon className="size-2.5 shrink-0 opacity-50" name="chevron-down" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="w-72 p-1" side="top" sideOffset={8}>
        <BrowserApprovalModeMenu mode={mode} setMode={setMode} />
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  )
}
