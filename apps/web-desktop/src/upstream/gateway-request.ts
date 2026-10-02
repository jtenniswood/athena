import { useCallback } from 'react'
import { useGatewayRequest } from '@/app/gateway/hooks/use-gateway-request'
import type { BrowserApprovalRequester } from '../experience/contracts/actions'

/** Expose the renderer's reconnecting request command through a browser contract. */
export function useBrowserGatewayRequest(): BrowserApprovalRequester {
  const { requestGateway } = useGatewayRequest()
  return useCallback((method, params) => requestGateway(method, params), [requestGateway])
}
