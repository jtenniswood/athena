import { useStore } from '@nanostores/react'
import { useEffect } from 'react'
import { $backendUpdateApply, $backendUpdateChecking, $backendUpdateStatus, applyBackendUpdate, checkBackendUpdates } from '@/store/updates'
import { useBrowserGatewayStatus } from './browser-gateway-panel'

/** Reuse the renderer's update lifecycle so progress survives settings navigation. */
export function useBrowserBackendUpdates() {
  const status = useStore($backendUpdateStatus)
  const checking = useStore($backendUpdateChecking)
  const apply = useStore($backendUpdateApply)
  const { statusSnapshot } = useBrowserGatewayStatus()
  useEffect(() => { void checkBackendUpdates({ force: true }) }, [])
  return {
    status, checking, apply,
    version: status?.currentVersion || statusSnapshot?.version,
    check: () => checkBackendUpdates({ force: true }),
    install: applyBackendUpdate
  }
}
