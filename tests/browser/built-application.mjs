import { preview } from 'vite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))

/** One isolated gateway, preference directory and production preview per worker. */
export async function createBuiltApplication({ prepareHome, strict = false } = {}) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'athena-built-browser-'))
  const gateway = createPreviewGateway({ delay: 1, strict }), previous = new Map()
  let server
  const close = async () => {
    try { await server?.close() }
    finally {
      try { await gateway.close() }
      finally {
        for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
        rmSync(temporary, { recursive: true, force: true })
      }
    }
  }
  try {
    await prepareHome?.(temporary)
    await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve))
    const environment = {
      HERMES_GATEWAY_URL: `http://127.0.0.1:${gateway.server.address().port}`,
      HERMES_HOME: temporary,
      HERMES_PREFERENCES_DIR: path.join(temporary, 'preferences')
    }
    for (const [key, value] of Object.entries(environment)) { previous.set(key, process.env[key]); process.env[key] = value }
    server = await preview({ root: path.join(root, 'apps/web-desktop'), logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } })
    return { origin: `http://127.0.0.1:${server.httpServer.address().port}`, home: temporary, gateway, close }
  } catch (error) { await close(); throw error }
}
