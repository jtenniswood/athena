import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBuiltApplication } from './built-application.mjs'
import { createPreviewGateway } from '../../scripts/preview/gateway.mjs'
import { getBrowserTarget } from './test-target.mjs'

const { image, url } = getBrowserTarget()
if (url) throw new Error('Plugin discovery requires its isolated mounted home; use HERMES_TEST_IMAGE or the built preview fixture')
const folder = 'mounted #?% plugin'
const source = (id, name, version = 'original') => `
window.pluginEvaluations ??= {}; window.pluginEvaluations[${JSON.stringify(id)}] = true;
export default { id: ${JSON.stringify(id)}, name: ${JSON.stringify(name)}, register(ctx) {
  window.pluginMounts ??= {}; window.pluginMounts[${JSON.stringify(id)}] = (window.pluginMounts[${JSON.stringify(id)}] || 0) + 1;
  window.pluginVersions ??= {}; window.pluginVersions[${JSON.stringify(id)}] = ${JSON.stringify(version)};
  ctx.onDispose(() => { window.pluginDisposals ??= {}; window.pluginDisposals[${JSON.stringify(id)}] = (window.pluginDisposals[${JSON.stringify(id)}] || 0) + 1 });
} }
`
let application, home, gateway, container, origin
async function prepareHome(directory) {
  const standalone = path.join(directory, 'desktop-plugins', folder)
  const packaged = path.join(directory, 'desktop-plugins', 'packaged-plugin')
  const agent = path.join(directory, 'plugins', 'agent folder')
  await Promise.all([mkdir(standalone, { recursive: true }), mkdir(packaged, { recursive: true }), mkdir(agent, { recursive: true })])
  await Promise.all([
    writeFile(path.join(standalone, 'plugin.js'), source('fixture-mounted', 'Mounted review plugin')),
    writeFile(path.join(standalone, 'note #?.txt'), 'A nested plugin asset'),
    writeFile(path.join(packaged, 'plugin.js'), source('fixture-packaged', 'Packaged review plugin')),
    writeFile(path.join(packaged, '.hermes-package.json'), JSON.stringify({ package: 'fixture-package' })),
    writeFile(path.join(agent, 'package.json'), JSON.stringify({ name: 'agent-fixture' }))
  ])
}
test.beforeAll(async () => {
  if (!image) {
    application = await createBuiltApplication({ prepareHome })
    ;({ home, origin } = application)
    return
  }
  home = await mkdtemp(path.join(tmpdir(), 'athena-mounted-plugins-'))
  await prepareHome(home)
  gateway = createPreviewGateway({ delay: 1 })
  await new Promise(resolve => gateway.server.listen(0, '0.0.0.0', resolve))
  container = execFileSync('docker', ['run', '-d', '--rm', '--add-host', 'host.docker.internal:host-gateway',
    '-p', '127.0.0.1::80', '--mount', `type=bind,source=${home},target=/data/hermes,readonly`,
    '-e', `HERMES_GATEWAY_URL=http://host.docker.internal:${gateway.server.address().port}`, image], { encoding: 'utf8' }).trim()
  const port = execFileSync('docker', ['port', container, '80/tcp'], { encoding: 'utf8' }).trim().split(':').at(-1)
  origin = `http://127.0.0.1:${port}`
  await expect.poll(async () => { try { return (await fetch(origin)).status } catch { return 0 } }).toBe(200)
})
test.afterAll(async () => {
  try { if (container) execFileSync('docker', ['stop', container], { stdio: 'ignore' }) }
  finally {
    await gateway?.close()
    if (application) await application.close()
    else if (home) await rm(home, { recursive: true, force: true })
  }
})
const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
test.beforeEach(async ({ page }) => {
  await page.route('https://nousresearch.github.io/hermes-agent/docs/api/*.json', route => route.fulfill({ json: [] }))
  await page.goto(`${origin}/#/preview-week`)
  await expect(composer(page)).toBeVisible({ timeout: 30000 })
  await composer(page).fill('Keep this mounted-plugin draft')
  await expect.poll(() => page.evaluate(() => window.pluginMounts?.['fixture-mounted'])).toBe(1)
})

test('a real mounted plugin registers from nested metadata and encoded asset paths', async ({ page }) => {
  const result = await page.evaluate(async folder => {
    const root = await window.hermesDesktop.desktopPluginsRoot()
    const directory = `${root}/${encodeURIComponent(folder)}`
    const listing = await window.hermesDesktop.readDir(directory)
    const asset = listing.entries.find(entry => entry.name === 'note #?.txt')
    const agent = `${location.origin}/plugins/agent%20folder`
    return { listing, bytes: await window.hermesDesktop.readFileText(asset.path),
      agent: await window.hermesDesktop.readDir(agent), watcher: typeof window.hermesDesktop.watchDirectory,
      fileWatch: await window.hermesDesktop.watchPreviewFile(`${directory}/plugin.js`) }
  }, folder)
  expect(result.listing.entries).toContainEqual({ name: 'plugin.js', path: `${origin}/desktop-plugins/${encodeURIComponent(folder)}/plugin.js`, isDirectory: false })
  expect(result.bytes.text).toBe('A nested plugin asset')
  expect(result.agent.entries).toEqual([{ name: 'package.json', path: `${origin}/plugins/agent%20folder/package.json`, isDirectory: false }])
  expect(result.watcher).toBe('undefined')
  expect(result.fileWatch).toMatchObject({ ok: false, error: 'unsupported' })
  await expect(composer(page)).toHaveText('Keep this mounted-plugin draft')
})

test('the engine polling fallback discovers, removes and restores a mounted plugin', async ({ page }) => {
  test.setTimeout(60000)
  const late = path.join(home, 'desktop-plugins', 'late-plugin')
  try {
    await mkdir(late, { recursive: true })
    await writeFile(path.join(late, 'plugin.js'), source('fixture-late', 'Late review plugin'))
    await expect.poll(() => page.evaluate(() => window.pluginMounts?.['fixture-late']), { timeout: 15000 }).toBe(1)
    await rm(late, { recursive: true })
    await expect.poll(() => page.evaluate(() => window.pluginDisposals?.['fixture-late']), { timeout: 15000 }).toBe(1)
    await mkdir(late)
    await writeFile(path.join(late, 'plugin.js'), source('fixture-late', 'Late review plugin'))
    await expect.poll(() => page.evaluate(() => window.pluginMounts?.['fixture-late']), { timeout: 15000 }).toBe(2)
    await expect(composer(page)).toHaveText('Keep this mounted-plugin draft')
  } finally { await rm(late, { recursive: true, force: true }) }
})

test('package markers retain opt-in posture and explicit rescan reloads changed source', async ({ page }) => {
  await expect.poll(() => page.evaluate(() => window.pluginEvaluations?.['fixture-packaged'])).toBe(true)
  expect(await page.evaluate(() => window.pluginMounts?.['fixture-packaged'] || 0)).toBe(0)
  await page.evaluate(() => { window.location.hash = '/settings?tab=plugins' })
  await page.getByRole('link', { name: 'Manage plugins', exact: true }).click()
  await page.getByPlaceholder('Search plugins', { exact: true }).fill('Packaged review plugin')
  const packaged = page.getByRole('switch', { name: 'Packaged review plugin', exact: true })
  await expect(packaged).not.toBeChecked()
  await packaged.click()
  await expect.poll(() => page.evaluate(() => window.pluginMounts?.['fixture-packaged'])).toBe(1)
  const file = path.join(home, 'desktop-plugins', folder, 'plugin.js')
  try {
    await writeFile(file, source('fixture-mounted', 'Mounted review plugin', 'updated'))
    await page.getByRole('button', { name: 'Rescan', exact: true }).click()
    await expect.poll(() => page.evaluate(() => window.pluginVersions?.['fixture-mounted'])).toBe('updated')
    expect(await page.evaluate(() => window.pluginDisposals?.['fixture-mounted'])).toBeGreaterThanOrEqual(1)
    await page.evaluate(() => { window.location.hash = '/preview-week' })
    await expect(composer(page)).toHaveText('Keep this mounted-plugin draft')
  } finally { await writeFile(file, source('fixture-mounted', 'Mounted review plugin')) }
})
