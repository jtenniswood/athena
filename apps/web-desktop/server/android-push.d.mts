import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Http2SecureServer } from 'node:http2'
import type { FirebaseSender } from './firebase-messaging.mjs'

export function createAndroidPush(options: {
  target: string
  identityUrl?: string
  sender: Pick<FirebaseSender, 'enabled' | 'send'>
  fetch?: typeof fetch
  now?: () => number
  directory?: string
  browserSender?: { enabled: boolean; publicKey(): string; send(subscription: object, data: Record<string, string>, ttl: number): Promise<unknown> }
  consumeTokenTicket?: (url: URL, origin: string) => string | undefined
}): {
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
  attach(server: Server | Http2SecureServer): void
  drain(): Promise<void>
  scanReplies(): Promise<void>
  close(): void
}
