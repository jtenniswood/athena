import type { IncomingMessage, ServerResponse } from 'node:http'

export function createAndroidAuthHandler(options: {
  target: string
  fetch?: typeof fetch
  now?: () => number
}): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
