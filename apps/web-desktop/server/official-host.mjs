import { createServer, request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { runtimeScripts } from '../../../scripts/runtime-config.mjs'

/** Hermes serves and authenticates the app; this door adds Athena's own services. */
export function createOfficialHost({ configuration, services, publicUrl }) {
  const target = new URL(configuration.target)
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest
  const publicOrigin = publicUrl ? new URL(publicUrl).origin : undefined
  const prepare = req => {
    // The configured public URL is authoritative when a TLS proxy fronts this port.
    const origin = publicOrigin || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`
    const external = new URL(origin)
    req.headers['x-forwarded-host'] = external.host
    req.headers['x-forwarded-proto'] = external.protocol.slice(0, -1)
  }
  const upstream = req => request({
    protocol: target.protocol, hostname: target.hostname, port: target.port,
    method: req.method, path: req.url, headers: { ...req.headers, host: target.host }
  })
  const server = createServer((req, res) => { void (async () => {
    prepare(req)
    if (await services.handle(req, res)) return
    const pathname = new URL(req.url, 'http://local.invalid').pathname
    const scripts = runtimeScripts(configuration)
    if (Object.hasOwn(scripts, pathname.slice(1))) {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(scripts[pathname.slice(1)])
      return
    }
    if (pathname === '/build-info.json') {
      const info = await readFile(path.join(configuration.staticRoot, 'build-info.json'))
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(info)
      return
    }
    const proxy = upstream(req)
    proxy.on('response', response => {
      res.writeHead(response.statusCode, response.headers)
      response.pipe(res)
    })
    proxy.on('error', () => {
      if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      res.end('Hermes is starting. Try again shortly.')
    })
    req.on('aborted', () => proxy.destroy())
    res.on('close', () => { if (!res.writableFinished) proxy.destroy() })
    req.pipe(proxy)
  })().catch(() => {
    if (!res.headersSent) res.writeHead(503, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
    res.end('Athena is temporarily unavailable.')
  }) })
  services.attach(server)
  server.prependListener('upgrade', prepare)
  server.on('upgrade', (req, socket, head) => {
    // The push extension owns this upgrade and retains its Hermes connection.
    if (new URL(req.url, 'http://local.invalid').pathname === '/api/athena/android/ws') return
    prepare(req)
    const proxy = upstream(req)
    proxy.on('upgrade', (response, remote, remoteHead) => {
      socket.write(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`)
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        socket.write(`${response.rawHeaders[i]}: ${response.rawHeaders[i + 1]}\r\n`)
      }
      socket.write('\r\n')
      if (remoteHead.length) socket.write(remoteHead)
      if (head.length) remote.write(head)
      socket.pipe(remote).pipe(socket)
      remote.on('error', () => socket.destroy())
      socket.on('close', () => remote.destroy())
    })
    proxy.on('response', response => {
      socket.end(`HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\nConnection: close\r\n\r\n`)
      response.resume()
    })
    proxy.on('error', () => socket.destroy())
    socket.on('error', () => proxy.destroy())
    socket.on('close', () => proxy.destroy())
    proxy.end()
  })
  return server
}
