import path from 'node:path'
import { replaceBrowserContract } from './contract'

export function useBrowserMessagingPresentation(source: string, root: string): string {
  const owner = JSON.stringify(path.join(root, 'src/experience/messaging'))
  return replaceBrowserContract(source, [
    ["import { DetailColumn, ListColumn, MasterDetail } from '../master-detail'", `import { BrowserMessagingDetail as DetailColumn, BrowserMessagingList as ListColumn, BrowserMessagingLayout as MasterDetail, BrowserMessagingShell as PageSearchShell } from ${owner}`],
    ["import { PageSearchShell } from '../page-search-shell'\n", ''],
    ['              <ListColumn>', '              <ListColumn empty={visiblePlatforms.length === 0}>'],
    ['      onClick={onSelect}\n      type="button"', '      data-browser-messaging-platform={platform.id}\n      aria-current={active ? \'true\' : undefined}\n      onClick={onSelect}\n      type="button"'],
    ['        <span className="truncate text-[length:var(--conversation-text-font-size)] font-normal">{platform.name}</span>', '<span className="browser-messaging-platform-label"><span>{platform.name}</span><span>{stateLabel(platform.state, t.messaging)}</span></span>'],
    ['            onClick={() => setShowAdvanced(value => !value)}', '            aria-expanded={showAdvanced}\n            onClick={() => setShowAdvanced(value => !value)}']
  ])
}

export function useBrowserCatalogIdleTask(source: string, root: string): string {
  const before = `  const id = requestIdleCallback(() => void queryClient.prefetchQuery(catalogQuery(kind)), { timeout: 5_000 })

  return () => cancelIdleCallback(id)`
  if (source.split(before).length !== 2) throw new Error('Catalog idle prefetch boundary changed')
  return `import { scheduleBrowserIdleTask } from ${JSON.stringify(path.join(root, 'src/platform/idle'))}\n` +
    source.replace(before, '  return scheduleBrowserIdleTask(() => void queryClient.prefetchQuery(catalogQuery(kind)))')
}

export function useBrowserStylesheetOwner(source: string): string {
  // entry.ts loads web.css, which already imports the complete renderer stylesheet.
  // A second Tailwind compilation loads later and overrides responsive utilities.
  const before = "import './styles.css'\n"
  if (source.split(before).length !== 2) throw new Error('Browser renderer stylesheet import changed')
  return source.replace(before, '')
}

export function useBrowserErrorFallback(source: string, root: string): string {
  const start = source.indexOf('function RootErrorFallback({ error, reset }: ErrorBoundaryFallbackProps) {')
  if (start < 0 || !source.slice(start).includes('t.errors.sendDiagnostics')) throw new Error('Browser error fallback boundary changed')
  const imports = [
    "import { Button } from '@/components/ui/button'\n",
    "import { ErrorState } from '@/components/ui/error-state'\n",
    "import { useI18n } from '@/i18n'\n",
    "import { requestSendDiagnostics } from '@/store/send-diagnostics'\n"
  ]
  let output = source.slice(0, start)
  for (const line of imports) output = output.replace(line, '')
  return `import { BrowserErrorFallback as RootErrorFallback } from ${JSON.stringify(path.join(root, 'src/experience/browser-error-fallback'))}\n` + output
}

/** Keep upstream boot/error/reconnect ownership; only adapt its loading visual. */
export function useBrowserConnectingVisual(source: string): string {
  const start = source.indexOf('function ConnectingOverlayView(')
  const end = source.indexOf('/**\n * Held until the app knows whether onboarding runs', start)
  if (start < 0 || end < 0 || !source.slice(start, end).includes('<DecodeText')) {
    throw new Error('Gateway connecting presentation changed')
  }
  return source.slice(0, start)
    .replace("import { DecodeText } from '@/components/ui/decode-text'\n", '')
    .replace("import { cn } from '@/lib/utils'\n", '')
    .replace("const TEXT = 'CONNECTING'\n", '') + `function ConnectingOverlayView({ onExit, phase }: ConnectingOverlayViewProps) {
  return (
    <div className="hermes-startup-loading athena-connecting-overlay" role="status" data-glass-opaque=""
      style={{ opacity: phase === 'overlay-out' || phase === 'gone' ? 0 : 1 }}>
      {onExit ? <SlowSetupStart onExit={onExit} /> : <>
        <img className="hermes-startup-logo" src="/athena.svg" width="64" height="64" alt="" aria-hidden="true" />
        <span className="hermes-startup-spinner" aria-hidden="true" />
        <span className="hermes-startup-label">Connecting to Hermes…</span>
      </>}
    </div>
  )
}

` + source.slice(end)
}

export function filterBrowserActivityToasts(source: string): string {
  const target = '      host.notify({'
  if (source.split(target).length !== 2 || !source.includes('`${label} has new activity`')) {
    throw new Error('Browser activity notification target changed')
  }
  // Keep unread tracking and explicit incoming-message alerts, but omit the
  // generic roster activity toast that adds no information to the browser UI.
  return source.replace(target, '      if (inbound) host.notify({')
}

// Suppress only the automatic desktop updater notice at its owner. Explicit
// update settings/actions and unrelated notifications keep their behavior.
export function omitBrowserDesktopUpdateNotice(source: string): string {
  const start = source.indexOf('export function maybeNotifyUpdateAvailable(')
  const end = source.indexOf('\n/**', start)
  if (start < 0 || end < 0) throw new Error('Browser update notice owner changed')
  return source.slice(0, start) + 'export function maybeNotifyUpdateAvailable(_status: DesktopUpdateStatus | null, _target: UpdateTarget = \'client\') {}\n' + source.slice(end)
}

export function useBrowserSetupHooks(source: string): string {
  // These are reviewed component roots, checked by the registry at build time.
  const pattern = /<div className="fixed inset-0 z-\(--z-setup\)[^"]*">\n(\s*)<div className=/g
  const matches = [...source.matchAll(pattern)]
  const expected = source.includes('function DesktopInstallOverlay') ? 3 : 1
  if (matches.length !== expected) throw new Error('Browser setup surface changed')
  return source.replace(pattern, (match, indent) => match.replace('<div ', '<div data-browser-overlay="setup" ').replace('\n' + indent + '<div ', '\n' + indent + '<div data-browser-overlay-card="setup" '))
}

export function useBrowserSearchLabel(source: string, root: string): string {
  const ariaTarget = 'aria-label={s.searchAria}'
  const placeholderTarget = 'placeholder={s.searchPlaceholder}'
  if (source.split(ariaTarget).length !== 2 || source.split(placeholderTarget).length !== 2) {
    throw new Error('Browser sidebar search label target changed')
  }
  const slotTarget = '              value={searchQuery}\n            />'
  if (source.split(slotTarget).length !== 2) throw new Error('Browser sidebar disclosure target changed')
  const settingsSlot = '                  </SidebarMenuItem>\n                )\n              })}'
  if (source.split(settingsSlot).length !== 2) throw new Error('Browser sidebar settings slot changed')
  const extras = JSON.stringify(path.join(root, 'src/experience/sidebar-extras.tsx'))
  // Give the browser visibility preference a stable, label-independent target.
  const pinnedTarget = 'rootClassName="shrink-0 p-0 pb-1"'
  if (source.split(pinnedTarget).length !== 2) throw new Error('Browser pinned section target changed')
  const pinnedSection = '{!trimmedQuery && ('
  const pinnedSectionStart = source.lastIndexOf(pinnedSection, source.indexOf(pinnedTarget))
  if (pinnedSectionStart < 0 || !source.slice(pinnedSectionStart, source.indexOf(pinnedTarget)).includes('<SidebarSessionsSection')) throw new Error('Browser pinned section visibility target changed')
  const hooks: [string, string][] = [
    ['<div className="shrink-0 px-2 pb-1 pt-1">', '<div className="browser-session-search-section shrink-0 px-2 pb-1 pt-1">'],
    ['<SearchField', '<SearchField containerClassName="browser-session-search"'],
    ['rootClassName="min-h-32 flex-1 overflow-hidden p-0"', 'rootClassName="browser-session-list-section min-h-32 flex-1 overflow-hidden p-0"'],
    ["'min-h-32 flex-1 overflow-hidden p-0'", "'browser-session-list-section min-h-32 flex-1 overflow-hidden p-0'"]
  ]
  for (const [before, after] of hooks) {
    if (source.split(before).length !== 2) throw new Error('Browser sidebar styling target changed')
    source = source.replace(before, after)
  }
  // Use resolved pins, including backend pins, rather than DOM rows: a
  // collapsed populated section must still keep its heading visible.
  const currentPinnedTarget = source.indexOf(pinnedTarget)
  const currentPinnedStart = source.lastIndexOf(pinnedSection, currentPinnedTarget)
  if (currentPinnedStart < 0) throw new Error('Browser pinned section visibility target changed')
  source = source.slice(0, currentPinnedStart) + source.slice(currentPinnedStart).replace(pinnedSection, '{!trimmedQuery && pinnedSessions.length > 0 && (')
  return (`import { BrowserSidebarExtras, BrowserSidebarSettings } from ${extras}\n` + source)
    .replace(pinnedTarget, 'rootClassName="browser-pinned-section shrink-0 p-0 pb-1"')
    .replace(slotTarget, slotTarget + '\n            <BrowserSidebarExtras />')
    .replace(settingsSlot, '                    {isNewSession && <BrowserSidebarSettings />}\n' + settingsSlot)
    .replace(ariaTarget, "aria-label={'Search'}")
    .replace(placeholderTarget, "placeholder={'Search'}")
}

export function disableBrowserOnboardingTips(source: string): string {
  const tipImport = "import { TipHost } from '@/components/tips'\n"
  const tipHost = '<TipHost />'
  if (source.split(tipImport).length !== 2 || source.split(tipHost).length !== 2) {
    throw new Error('Browser onboarding tip host changed')
  }
  const onboardingGuard = '    if (!isMainWindow()) {'
  if (source.split(onboardingGuard).length !== 3) throw new Error('Browser onboarding window guards changed')
  return source.replace(tipImport, '').replace(tipHost, 'null')
    .replaceAll(onboardingGuard, '    if (window.__HERMES_WEB_BRIDGE__ || !isMainWindow()) {')
}
