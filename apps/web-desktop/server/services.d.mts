import type { IncomingMessage, ServerResponse, Server } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { FirebaseSender } from './firebase-messaging.mjs'

export function createAthenaServices(options: {
  target: string
  identityUrl?: string
  directory: string
  home?: string
  fetch?: typeof fetch
  now?: () => number
  sender?: Pick<FirebaseSender, 'enabled' | 'send'>
}): {
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
  attach(server: Server | Http2SecureServer): void
  close(): void
  drain(): Promise<void>
}
