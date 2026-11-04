import { ShieldLock, useI18n } from '../upstream/browser-api'
import { useBrowserEngine } from './engine'
import type { BrowserApprovalRequester as ApprovalModeRequester } from './contracts/actions'
import type { StatusbarItem } from '../upstream/browser-api'
import { BrowserApprovalModeMenu, browserApprovalChoices } from './approval-mode-menu'

export function useApprovalModeStatusbarItem(profile: string, requestGateway: ApprovalModeRequester, _gatewayState?: string, _routeIdentity?: unknown): StatusbarItem {
  const engine = useBrowserEngine()
  const { t } = useI18n()
  const copy = t.shell.approvalMode
  const { mode, setMode } = engine.approval.useMode(profile, requestGateway)
  const label = browserApprovalChoices(copy)[mode].label

  return {
    className: mode === 'off' ? 'bg-(--chrome-action-hover) text-foreground' : undefined,
    icon: <ShieldLock className="size-3.5" />,
    id: 'approval-mode',
    label,
    menuAlign: 'end',
    menuClassName: 'w-72 p-1',
    menuContent: <BrowserApprovalModeMenu mode={mode} setMode={setMode} />,
    title: copy.ariaLabel(label),
    variant: 'menu'
  }
}
