export interface FirebaseSender {
  enabled: boolean
  send(deviceToken: string, data: Record<string, string>, priority?: 'HIGH' | 'NORMAL'): Promise<void>
  validate(): Promise<void>
}
export function createFirebaseSender(options?: {
  credentialsPath?: string
  fetch?: typeof fetch
  now?: () => number
}): FirebaseSender
