import { officialRendererBuildOptions } from '../../scripts/hermes-vite-config.mjs'
import { rendererAdapterPlugin, adapterAliases } from '../../scripts/renderer-adapter.mjs'
import { runtimeConfiguration, runtimeScripts, matchesGatewayRoute, navigationFallbackDenylist, type HostingConfiguration } from '../../scripts/runtime-config.mjs'
import { compatibilitySingletons } from '../../scripts/aliases.mjs'
import { buildInfoPlugin } from '../../scripts/build-info.mjs'
import { createAthenaServices } from './server/services.mjs'
import { defineConfig, loadEnv, type Plugin, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createProxyServer, type ProxyServer } from 'http-proxy-3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { VitePWA } from 'vite-plugin-pwa'

// The desktop renderer ships a Vite config with everything this build needs
// (monorepo aliases, emojibase assets, chunking); this config reuses those
// patterns but points the entry at apps/desktop/src/main via src/entry.ts.
// The dynamic gateway proxy below is ported from hermes-ui (MIT) so dev-mode
// /api, /auth, /login and /api/ws route to a configured gateway same-origin.

// `hgui` symlinks a worktree's node_modules to the main checkout. Some asset
// URLs retain the worktree path while others resolve through the symlink, so
// allow both spellings before enforcing server.fs.allow.
const real = (p: string): string | null => {
  try {
    return fs.realpathSync(p)
  } catch {
    return null
  }
}

const fsAllow = [
  ...new Set(
    [
      path.resolve(__dirname, '..'),
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../../node_modules'),
      real(path.resolve(__dirname, 'node_modules')),
      real(path.resolve(__dirname, '../../node_modules'))
    ].filter((p): p is string => p !== null)
  )
]

// The emoji picker fetches emojibase JSON at runtime; serve the bundled
// emojibase-data package at a stable local path (same as desktop).
const emojibaseDir =
  real(path.resolve(__dirname, 'node_modules/emojibase-data')) ??
  real(path.resolve(__dirname, '../../node_modules/emojibase-data'))

const EMOJIBASE_PATH = /^[a-z-]+\/(data|messages|shortcodes\/emojibase)\.json$/

const emojibaseAssets = () => ({
  name: 'hermes:emojibase-assets',
  configureServer(server: {
    middlewares: { use: (route: string, handler: (req: any, res: any, next: () => void) => void) => void }
  }) {
    server.middlewares.use('/emojibase', (req, res, next) => {
      const rel = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
      if (!emojibaseDir || !EMOJIBASE_PATH.test(rel)) return next()
      fs.readFile(path.join(emojibaseDir, rel), (err: unknown, buf: Buffer) => {
        if (err) return next()
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
        res.end(buf)
      })
    })
  },
  generateBundle(this: { emitFile: (asset: { type: 'asset'; fileName: string; source: Uint8Array }) => void }) {
    if (!emojibaseDir) return
    for (const rel of ['en/data.json', 'en/messages.json', 'en/shortcodes/emojibase.json']) {
      this.emitFile({
        type: 'asset',
        fileName: `emojibase/${rel}`,
        source: fs.readFileSync(path.join(emojibaseDir, rel))
      })
    }
  }
})

// A single configured target is shared by development, preview, and nginx.
let hosting: HostingConfiguration = runtimeConfiguration()

// Shared wiring for the dev AND preview servers (preview serves the built
// dist — the production bundle — which still needs same-origin /api routing).
interface ProxyServerLike {
  middlewares: PreviewServer['middlewares']
  httpServer?: PreviewServer['httpServer'] | null
  config: PreviewServer['config']
}

function attachDynamicProxy(server: ProxyServerLike): void {
  const services = createAthenaServices({
    target: hosting.target,
    identityUrl: hosting.identityUrl,
    home: hosting.home,
    directory: process.env.HERMES_PREFERENCES_DIR || path.resolve(__dirname, '../../.athena/preferences')
  })
  if (server.httpServer) {
    services.attach(server.httpServer)
  }
  // Route HTTPS hostname-based gateways correctly (including Cloudflare
  // Tunnel) while retaining the app origin in forwarded metadata.
  const proxy: ProxyServer = createProxyServer({ changeOrigin: true, secure: true, ws: true })

  const preserveBrowserOrigin = (proxyReq: import('node:http').ClientRequest, req: IncomingMessage): void => {
    if (req.headers.host) {proxyReq.setHeader('X-Forwarded-Host', req.headers.host)}
    const encrypted = (req.socket as import('node:tls').TLSSocket).encrypted
    proxyReq.setHeader('X-Forwarded-Proto', req.headers['x-forwarded-proto'] ?? (encrypted ? 'https' : 'http'))
  }

  proxy.on('proxyReq', preserveBrowserOrigin)
  proxy.on('proxyReqWs', preserveBrowserOrigin)

  proxy.on('error', (err, _req, resOrSocket) => {
    server.config.logger.error(`[hermes-proxy] ${err.message}`, { timestamp: true })

    if (resOrSocket && 'writeHead' in resOrSocket) {
      const res = resOrSocket as ServerResponse

      if (!res.headersSent) {res.writeHead(502, { 'content-type': 'text/plain' })}
      res.end('gateway proxy error')
    } else if (resOrSocket) {
      ;(resOrSocket as Socket).destroy()
    }
  })

  server.middlewares.use((req, res, next) => { void (async () => {
    const pathname = req.url?.split('?')[0]
    if (await services.handle(req, res)) return
    const scripts = runtimeScripts(hosting)
    if (pathname && Object.hasOwn(scripts, pathname.slice(1))) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(scripts[pathname.slice(1)])
      return
    }
    if (!matchesGatewayRoute(req.url)) return next()
    proxy.web(req, res, { target: hosting.target })
  })().catch(next) })

  server.httpServer?.on('upgrade', (req, socket, head) => {
    if (['/api/athena/android/ws', '/api/athena/gateway/ws'].includes(req.url?.split('?')[0] || '')) return
    if (!matchesGatewayRoute(req.url)) return
    proxy.ws(req, socket, head, { target: hosting.target })
  })
}

function hermesDynamicProxy(): Plugin {
  return {
    name: 'hermes-dev-dynamic-proxy',
    configureServer(server) {
      attachDynamicProxy(server)
    },
    configurePreviewServer(server) {
      attachDynamicProxy(server)
    }
  }
}

export default defineConfig(({ command, mode }) => {
  // Extra hostnames allowed past Vite's Host check, from apps/web-desktop/.env
  // (WEB_ALLOWED_HOSTS, comma-separated) — e.g. Tailscale names, LAN hostnames.
  const env = loadEnv(mode, __dirname, '')
  hosting = runtimeConfiguration({ HERMES_GATEWAY_URL: 'http://127.0.0.1:9119', HERMES_HOME: path.join(os.homedir(), '.hermes'), ...env, ...process.env })
  const envAllowedHosts = (env.WEB_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  // The browser shell is the only supported web entry point. Installing the
  // wrapper plugin unconditionally prevents a stale desktop build from being
  // shipped when a developer or deployment omits the legacy experience selector.
  return {
  base: './',
  plugins: [
    rendererAdapterPlugin(__dirname),
    buildInfoPlugin(),
    hermesDynamicProxy(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      // We register the SW ourselves from src/pwa/register.ts.
      injectRegister: null,
      manifest: {
        name: 'Athena for Hermes Agent',
        short_name: 'Athena',
        description: 'Athena, a web interface for Hermes Agent.',
        display: 'standalone',
        // Hash-routed SPA at the domain root.
        start_url: '.',
        scope: '.',
        background_color: '#111111',
        theme_color: '#0a0a0a',
        icons: [
          { src: 'athena.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'athena.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'athena.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        // Add click/focus handling to service-worker notifications while
        // keeping the normal generated Workbox precache behavior.
        importScripts: ['notifications-sw.js', 'update-coordinator-sw.js'],
        skipWaiting: false,
        clientsClaim: true,
        // Precache the whole app shell; the largest chunk (shiki) is ~19 MB,
        // so keep the per-file cap generous.
        globPatterns: ['index.html', 'athena.png', 'athena.svg', 'assets/**/*.{js,css,woff,woff2,ttf,otf,png,svg,webp}'],
        // Generated by the running proxy/container, not by the frontend build.
        // Precaching the empty build-time file hides the configured gateway.
        globIgnores: ['**/gateway-config.js', '**/runtime-config.js', '**/build-info.json'],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Gateway, proxy sign-in callbacks, and deployment metadata must hit
        // the network even while an older app shell controls this browser.
        // Startup recovery must reach the edge to renew an expired sign-in,
        // even when a cached app shell is available to the service worker.
        runtimeCaching: [
          {
            urlPattern: /\/(?:runtime-config|gateway-config)\.js(?:\?.*)?$/,
            handler: 'NetworkOnly'
          }
        ],
        navigateFallbackDenylist: navigationFallbackDenylist
      },
      devOptions: {
        // Keep the SW off in dev so it can't shadow the Vite proxy.
        enabled: false
      }
    }),
    emojibaseAssets()
  ],
  ...officialRendererBuildOptions(),
  resolve: {
    // The renderer sources are SYMLINKED from the pinned nix input in dev
    // (nix develop); realpathing them would make Vite look for node_modules
    // under the read-only store path and fail to resolve bare imports.
    preserveSymlinks: true,
    alias: adapterAliases(__dirname),
    dedupe: compatibilitySingletons(__dirname)
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    allowedHosts: [...envAllowedHosts, 'prod-server', 'hermes-web.emu-nessie.ts.net', '.ts.net'],
    fs: {
      allow: fsAllow
    }
  },
  preview: {
    host: '0.0.0.0',
    port: 4174
  }
  }
})
