import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { runtimeConfiguration } from '../../../scripts/runtime-config.mjs'
import { createAthenaServices } from './services.mjs'

const config = runtimeConfiguration()
const services = createAthenaServices({
  target: config.target,
  identityUrl: config.identityUrl,
  directory: config.preferencesDir,
  home: config.home,
  openCodeGoApiKey: config.openCodeGoApiKey
})
const server = createServer((req, res) => { void services.handle(req, res).then(handled => { if (!handled) { res.writeHead(404); res.end() } }) })
services.attach(server)
server.requestTimeout = 15000
server.listen(4181, '127.0.0.1', () => {
  const nginx = spawn('nginx', ['-g', 'daemon off;'], { stdio: 'inherit' })
  const stop = signal => { services.close(); server.close(); nginx.kill(signal) }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
  nginx.on('error', () => { services.close(); server.close(); process.exitCode = 1 })
  nginx.on('exit', code => { services.close(); server.close(); process.exitCode = code ?? 1 })
  server.on('error', () => { stop('SIGTERM'); process.exitCode = 1 })
})
server.on('error', error => { console.error('Athena settings service could not start:', error.code); process.exitCode = 1 })
