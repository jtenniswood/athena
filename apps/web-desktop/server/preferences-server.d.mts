import type { IncomingMessage, ServerResponse } from 'node:http'
export const preferencesPath: string
export function createPreferencesHandler(options: { target: string; directory: string; fetch?: typeof fetch }): (req: IncomingMessage, res: ServerResponse) => Promise<boolean>
