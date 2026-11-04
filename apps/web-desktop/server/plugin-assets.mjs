import { open, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'

const contentTypes = {
  '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.map': 'application/json',
  '.css': 'text/css', '.html': 'text/html', '.txt': 'text/plain', '.md': 'text/plain', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon', '.wasm': 'application/wasm', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.ogg': 'audio/ogg', '.mp4': 'video/mp4', '.webm': 'video/webm'
}

/** One reader owns metadata and bytes from the mounted web-server plugin roots. */
export function createPluginAssets({ home }) {
  return async (req, res) => {
    if (!home) return false
    const pathname = new URL(req.url, 'http://local.invalid').pathname
    const match = /^\/(desktop-plugins|plugins)(\/.*)?$/.exec(pathname)
    if (!match) return false
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    const send = (status, value) => {
      const body = JSON.stringify(value)
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) })
      res.end(req.method === 'HEAD' ? undefined : body)
      return true
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('Allow', 'GET, HEAD')
      return send(405, { error: 'Method not allowed' })
    }
    const root = path.resolve(home, match[1])
    const listing = /\/\.listing\/?$/.test(match[2] || '')
    let target
    try {
      if (/%2f|%5c/i.test(pathname)) throw new Error('Invalid separator')
      const relative = decodeURIComponent((match[2] || '').replace(/\/\.listing\/?$/, ''))
      if (/[\\\0]/.test(relative)) throw new Error('Invalid path')
      target = path.resolve(root, '.' + relative)
      if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Outside root')
    } catch { return send(404, { error: 'Plugin asset is unavailable' }) }
    let file
    try {
      if (listing) {
        const entries = await readdir(target, { withFileTypes: true })
        const rows = await Promise.all(entries.map(async entry => {
          // Operator symlinks use the same reader for metadata and file bytes.
          const info = entry.isSymbolicLink() ? await stat(path.join(target, entry.name)).catch(() => null) : entry
          const type = info?.isDirectory() ? 'directory' : info?.isFile() ? 'file' : null
          return type ? { name: entry.name, type } : null
        }))
        return send(200, rows.filter(Boolean))
      }
      file = await open(target)
      const info = await file.stat()
      if (!info.isFile()) return send(404, { error: 'Plugin asset is unavailable' })
      let start = 0, end = info.size - 1, status = 200
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
      if (range && (range[1] || range[2])) {
        start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]))
        end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) {
          res.setHeader('Content-Range', `bytes */${info.size}`)
          return send(416, { error: 'Range is unavailable' })
        }
        status = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
      }
      res.writeHead(status, { ...headers, 'Content-Type': contentTypes[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'Content-Length': Math.max(0, end - start + 1), 'Accept-Ranges': 'bytes' })
      if (req.method === 'HEAD' || info.size === 0) res.end()
      else await pipeline(file.createReadStream({ start, end, autoClose: false }), res)
      return true
    } catch (error) {
      if (res.headersSent) { res.destroy(); return true }
      if (listing && error.code === 'ENOENT' && target === root) return send(200, [])
      return send(['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code) ? 404 : 503, { error: 'Plugin asset is unavailable' })
    } finally { await file?.close() }
  }
}
