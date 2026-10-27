import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { runtimeConfiguration } from './runtime-config.mjs'
import { createPreferencesHandler } from './preferences-server.mjs'
import { createAndroidAuthHandler } from './android-auth.mjs'
import { createAndroidPush } from './android-push.mjs'
import { createFirebaseSender } from './firebase-messaging.mjs'

const config = runtimeConfiguration()
const handler = createPreferencesHandler({ target: config.target, directory: config.preferencesDir })
const androidAuth = createAndroidAuthHandler({ target: config.target })
const push = createAndroidPush({ target: config.target, sender: createFirebaseSender() })
const server = createServer((req, res) => { void androidAuth(req, res).then(handled => handled || push.handle(req, res)).then(handled => handled || handler(req, res)).then(handled => { if (!handled) { res.writeHead(404); res.end() } }) })
push.attach(server)
server.requestTimeout = 15000
server.listen(4181, '127.0.0.1', () => {
  const nginx = spawn('nginx', ['-g', 'daemon off;'], { stdio: 'inherit' })
  const stop = signal => { push.close(); server.close(); nginx.kill(signal) }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
  nginx.on('error', () => { server.close(); process.exitCode = 1 })
  nginx.on('exit', code => { push.close(); server.close(); process.exitCode = code ?? 1 })
  server.on('error', () => { stop('SIGTERM'); process.exitCode = 1 })
})
server.on('error', error => { console.error('Athena settings service could not start:', error.code); process.exitCode = 1 })
