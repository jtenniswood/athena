import { runtimeConfiguration } from '../../../scripts/runtime-config.mjs'
import { createAthenaServices } from './services.mjs'
import { createOfficialHost } from './official-host.mjs'

const configuration = runtimeConfiguration()
const services = createAthenaServices({
  target: configuration.target, identityTarget: configuration.identityTarget,
  home: configuration.home, directory: configuration.preferencesDir, pluginAssets: false
})
const server = createOfficialHost({ configuration, services, publicUrl: process.env.ATHENA_PUBLIC_URL })
server.listen(Number(process.env.HERMES_PORT || 4174), process.env.HERMES_BIND || '0.0.0.0', () => {
  console.log(JSON.stringify({ service: 'athena', event: 'listening', port: Number(process.env.HERMES_PORT || 4174) }))
})
const stop = () => {
  services.close()
  server.close()
  server.closeAllConnections()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
server.on('error', error => {
  console.error(JSON.stringify({ service: 'athena', event: 'listen_failed', code: error.code }))
  stop()
  process.exitCode = 1
})
