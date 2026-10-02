import { test, expect } from '@playwright/test'
import { createServer, request } from 'node:http'
import { request as requestHttps } from 'node:https'
import { execFileSync } from 'node:child_process'
import { getBrowserTarget } from './test-target.mjs'

const { image, url } = getBrowserTarget()
test.skip(!image && !url && !process.env.CI, 'Set HERMES_TEST_IMAGE or HERMES_BROWSER_PREVIEW_URL')

// An expired edge session redirects network requests while the installed PWA
// can still serve its cached shell. No real proxy account or gateway is used.
test('configuration recovery reaches proxy sign-in and preserves browser data', async ({ page }) => {
  let container, server
  let expired = false
  try {
    let upstream = url
    if (!upstream) {
      if (!image) throw new Error('HERMES_TEST_IMAGE is required in CI')
      container = execFileSync('docker', ['run', '-d', '--rm', '-p', '127.0.0.1::80', image], { encoding: 'utf8' }).trim()
      const port = execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)
      upstream = `http://127.0.0.1:${port}`
    }
    await expect.poll(async () => { try { return (await fetch(upstream)).status } catch { return 0 } }).toBe(200)
    const proxyRequest = new URL(upstream).protocol === 'https:' ? requestHttps : request
    server = createServer((req, res) => {
      const target = new URL(req.url, 'http://fixture.test')
      res.setHeader('Cache-Control', 'no-store')
      if (target.pathname === '/cdn-cgi/access/login') {
        res.setHeader('Content-Type', 'text/html')
        res.end(`<h1>Proxy sign-in</h1><a href="/cdn-cgi/access/authorized?return=${encodeURIComponent(target.searchParams.get('return') || '/')}">Sign in</a>`)
      } else if (target.pathname === '/cdn-cgi/access/authorized') {
        expired = false
        res.writeHead(302, { Location: target.searchParams.get('return') || '/' }); res.end()
      } else if (expired) {
        res.writeHead(302, { Location: `/cdn-cgi/access/login?return=${encodeURIComponent(req.url)}` }); res.end()
      } else {
        const proxy = proxyRequest(new URL(req.url, upstream), { method: req.method, headers: req.headers }, response => {
          res.writeHead(response.statusCode, response.headers); response.pipe(res)
        })
        proxy.on('error', () => { res.writeHead(502); res.end() })
        req.pipe(proxy)
      }
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = `http://127.0.0.1:${server.address().port}`
    await page.goto(`${origin}/?fixture=keep`)
    await page.waitForFunction(() => navigator.serviceWorker.controller && typeof window.hermesDesktop?.getConnection === 'function')
    await page.evaluate(() => localStorage.setItem('fixture-startup-draft', 'Keep my saved draft'))
    expired = true
    const response = await page.reload()
    expect(response.fromServiceWorker()).toBe(true)
    await expect(page.getByRole('heading', { name: 'Hermes could not read its runtime configuration.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Proxy sign-in' })).toBeVisible()
    await page.getByRole('link', { name: 'Sign in', exact: true }).click()
    await page.waitForFunction(() => typeof window.hermesDesktop?.getConnection === 'function')
    await expect(page.locator('.hermes-startup-recovery')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => new URL(location.href).searchParams.has('hermes-reconnect'))).toBe(false)
    expect(new URL(page.url()).searchParams.get('fixture')).toBe('keep')
    expect(await page.evaluate(() => localStorage.getItem('fixture-startup-draft'))).toBe('Keep my saved draft')
  } finally {
    server?.closeAllConnections()
    if (server) await new Promise(resolve => server.close(resolve))
    if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' })
  }
})
