import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rendererLock, repositoryRoot, verifyRenderer } from './renderer.mjs'

const manifest = file => JSON.parse(readFileSync(file, 'utf8'))
const versions = value => ({ ...value.dependencies, ...value.devDependencies })

/** Inherit direct renderer versions and its locked Shiki family; retain only reviewed exceptions. */
export function syncRendererDependencies(root = repositoryRoot) {
  verifyRenderer(root)
  const upstream = manifest(path.join(root, 'apps/desktop/package.json'))
  const browserPath = path.join(root, 'apps/web-desktop/package.json')
  const browser = manifest(browserPath)
  const policy = manifest(path.join(root, 'scripts/renderer-dependencies.json'))
  const expected = versions(upstream)
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(browser[section] || {})) {
      if (!expected[name]) continue
      const override = policy.overrides[name]
      if (override && override.upstream !== expected[name]) throw new Error(`Review the renderer dependency override: ${name}`)
      browser[section][name] = override?.version ?? expected[name]
    }
  }
  const lock = manifest(path.join(root, '.renderer', rendererLock(root).rev, 'package-lock.json'))
  const resolutions = Object.fromEntries(Object.entries(lock.packages).filter(([name]) =>
    /^node_modules\/@shikijs\//.test(name)).map(([name, entry]) => [name.slice('node_modules/'.length), entry.version]))
  if (!resolutions['@shikijs/types']) throw new Error('The official renderer lock has no Shiki baseline.')
  const workspacePath = path.join(root, 'pnpm-workspace.yaml')
  const workspace = readFileSync(workspacePath, 'utf8').replace(/\n# Official renderer transitive baseline\n(overrides: .*\n)?/, '\n')
  if (/^overrides:/m.test(workspace)) throw new Error('Review existing pnpm overrides before inheriting the renderer baseline.')
  writeFileSync(browserPath, JSON.stringify(browser, null, 2) + '\n')
  writeFileSync(workspacePath, workspace.trimEnd() + '\n\n# Official renderer transitive baseline\noverrides: ' + JSON.stringify(resolutions) + '\n')
  return resolutions
}

/** Renderer-sensitive packages inherit the pin unless an override was reviewed. */
export function compareRendererDependencies(upstream, browser, policy) {
  const expected = versions(upstream)
  const actual = versions(browser)
  for (const name of Object.keys(policy.overrides)) {
    if (!policy.packages.includes(name)) throw new Error(`Override outside the renderer baseline: ${name}`)
  }
  return policy.packages.map(name => {
    const override = policy.overrides[name]
    if (!expected[name] || !actual[name]) throw new Error(`Missing renderer dependency: ${name}`)
    if (override && (!override.reason?.trim() || override.upstream !== expected[name] || override.version === expected[name])) {
      throw new Error(`Review the renderer dependency override: ${name}`)
    }
    const required = override?.version ?? expected[name]
    return { name, upstream: expected[name], browser: actual[name], required,
      status: actual[name] !== required ? 'review-required' : override ? 'reviewed-override' : 'upstream',
      reason: override?.reason ?? 'Uses the pinned renderer version.' }
  })
}

export function rendererDependencyReport(root = repositoryRoot) {
  verifyRenderer(root)
  const upstream = manifest(path.join(root, 'apps/desktop/package.json'))
  const browser = manifest(path.join(root, 'apps/web-desktop/package.json'))
  const policy = manifest(path.join(root, 'scripts/renderer-dependencies.json'))
  const renovation = manifest(path.join(root, 'renovate.json'))
  const grouped = renovation.packageRules.find(rule => rule.groupName === 'renderer compatibility')?.matchPackageNames ?? []
  if (JSON.stringify([...grouped].sort()) !== JSON.stringify([...policy.packages].sort())) {
    throw new Error('Keep the Renovate renderer group aligned with the reviewed dependency baseline.')
  }
  const rows = compareRendererDependencies(upstream, browser, policy)
  const sensitive = new Set(policy.packages)
  const upstreamVersions = versions(upstream)
  const otherDifferences = Object.entries(versions(browser)).filter(([name, version]) =>
    !sensitive.has(name) && upstreamVersions[name] && upstreamVersions[name] !== version
  ).map(([name, version]) => ({ name, upstream: upstreamVersions[name], browser: version, status: 'outside-baseline' }))
  return { renderer: rendererLock(root).rev, rows, otherDifferences }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--sync')) {
      syncRendererDependencies()
      console.log('Inherited official renderer dependency versions. Run pnpm install --no-frozen-lockfile, then review and check the resulting lockfile.')
    }
    const report = rendererDependencyReport()
    if (process.argv.includes('--report')) console.log(JSON.stringify(report, null, 2))
    else {
      for (const row of report.rows.filter(row => row.status === 'review-required')) {
        console.error(`${row.name}: browser ${row.browser}, reviewed ${row.required}, upstream ${row.upstream}`)
      }
      if (report.rows.some(row => row.status === 'review-required')) throw new Error('Renderer dependency changes need a reviewed baseline and focused verification.')
      console.log(`Renderer dependencies: ${report.rows.length} reviewed versions (${report.rows.filter(row => row.status === 'reviewed-override').length} explicit overrides)`)
    }
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
