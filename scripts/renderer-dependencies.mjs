import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rendererLock, repositoryRoot, verifyRenderer } from './renderer.mjs'

const manifest = file => JSON.parse(readFileSync(file, 'utf8'))
const versions = value => ({ ...value.dependencies, ...value.devDependencies })

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
