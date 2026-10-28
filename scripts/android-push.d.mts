import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { FirebaseSender } from './firebase-messaging.mjs'

export function createAndroidPush(options: {
  target: string
  sender: Pick<FirebaseSender, 'enabled' | 'send'>
  fetch?: typeof fetch
  now?: () => number
  directory?: string
}): {
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
  attach(server: Server | Http2SecureServer): void
  drain(): Promise<void>
  close(): void
}
