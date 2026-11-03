import path from 'node:path'
import { replaceBrowserContract } from './contract'

export function keepBrowserMessageBubblesSolid(source: string): string {
  const replacements: [string, string][] = [
    ['clampIntensity(storedString(KEY))', '(window.__HERMES_WEB_BRIDGE__ ? TRANSLUCENCY_MIN : clampIntensity(storedString(KEY)))'],
    ['$userBubbleTransparency.set(clampIntensity(value))', '$userBubbleTransparency.set(window.__HERMES_WEB_BRIDGE__ ? TRANSLUCENCY_MIN : clampIntensity(value))']
  ]
  let output = source
  for (const [before, after] of replacements) {
    if (output.split(before).length !== 2) throw new Error('Browser message bubble transparency boundary changed')
    output = output.replace(before, after)
  }
  return output
}

export function useBrowserMicrophoneCapture(source: string): string {
  const support = "    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {"
  const permission = `    const permitted = await window.hermesDesktop?.requestMicrophoneAccess?.()

    if (permitted === false) {
      throw new Error(copy.microphoneAccessDenied)
    }`
  const denied = '    return new Error(copy.microphonePermissionDenied)'
  for (const target of [support, permission, denied]) {
    if (source.split(target).length !== 2) throw new Error('Browser microphone capture target changed')
  }
  return source
    .replace(support, `    if (!window.isSecureContext) {
      throw new Error('Microphone recording requires HTTPS or localhost. Open this app using its HTTPS address, then allow microphone access.')
    }

${support}`)
    .replace(permission, `    // getUserMedia below requests browser permission and returns the recording
    // stream in one step. The desktop preflight opens and immediately closes
    // another stream, which can prompt twice or race device release.`)
    .replace(denied, `    return new Error(copy.microphoneAccessDenied + ' Allow microphone access for this site in your browser settings, then try again.')`)
}

export function useBrowserComposerLayoutWidth(source: string): string {
  const target = '    const { width } = composer.getBoundingClientRect()'
  if (source.split(target).length !== 2) throw new Error('Browser composer width target changed')
  return source.replace(target, `    // Breakpoints use layout pixels; screen coordinates include browser UI zoom.
    const width = composer.offsetWidth`)
}

export function useBrowserTouchHooks(source: string, root: string): string {
  const sendTarget = 'aria-label={showStop ? c.stop : sendLabel}'
  const labels = ['c.queueMessage', 'showStop ? c.stop : sendLabel', 'state.tools.label', 'copy.openModelPicker', 'triggerLabel', 'label', 'title']
  const targets = labels.map(label => `aria-label={${label}}`).filter(target => source.includes(target))
  if (!targets.length) throw new Error('Browser composer touch controls changed')
  let output = source
  for (const target of targets) {
    const expected = target === 'aria-label={label}' && source.includes('function renderSteerButton(') ? 2 : 1
    if (output.split(target).length !== expected + 1) throw new Error('Browser composer touch target changed: ' + target)
    output = output.replaceAll(target, `${target === sendTarget ? 'data-browser-send-action="" ' : ''}${target === 'aria-label={c.queueMessage}' ? 'data-browser-queue-action="" ' : ''}data-browser-composer-action="" ${target}`)
  }
  if (source.includes("const tourMarker = useTourMarker('model-pill')")) {
    const marker = 'data-tour={tourMarker}'
    const matches = output.split(marker).length - 1
    if (matches !== 2) throw new Error('Browser model pill marker boundary changed')
    output = output.replaceAll(marker, `data-browser-model-pill="" ${marker}`)
  }
  if (source.includes("import { ModelPill } from './model-pill'")) {
    const importTarget = "import { ModelPill } from './model-pill'\n"
    const reasoningTarget = '              {compactModelPill ? null : <ReasoningPill disabled={disabled} model={state.model} />}\n'
    if (output.split(importTarget).length !== 2 || output.split(reasoningTarget).length !== 2) throw new Error('Browser approval composer insertion point changed')
    // Follow-up routing uses upstream's running-turn-only queue control.
    const queueTarget = 'const showQueueButton = queueButtonVisible(busy, busyAction, hasComposerPayload, cardWaiting)'
    if (output.split(queueTarget).length !== 2) throw new Error('Browser queue control contract changed')
    output = output.replace(importTarget, `${importTarget}import { BrowserApprovalComposerControl } from ${JSON.stringify(`${root}/src/experience/browser-approval-composer-control`)}\n`)
      .replace(reasoningTarget, reasoningTarget + '              <BrowserApprovalComposerControl />\n')
  }
  return output
}

export function useBrowserAcceptedSubmit(source: string, root: string): string {
  const importTarget = 'import '
  const submitAccepted = '.then(accepted => {\n        if (accepted === false) {'
  const steerAccepted = '.then(accepted => {\n        if (!accepted) {\n          keep()\n        }'
  if (!source.startsWith(importTarget) || source.split(submitAccepted).length !== 2 || source.split(steerAccepted).length !== 2) {
    throw new Error('Browser accepted-submit boundary changed')
  }
  const owner = JSON.stringify(path.join(root, 'src/experience/ui/accepted-submit'))
  return `import { announceBrowserAcceptedSubmit } from ${owner}\n` + source
    .replace(submitAccepted, `.then(accepted => {\n        if (accepted !== false) announceBrowserAcceptedSubmit({ text, sessionId })\n        if (accepted === false) {`)
    .replace(steerAccepted, `.then(accepted => {\n        if (!accepted) {\n          keep()\n        } else {\n          announceBrowserAcceptedSubmit({ text, sessionId })\n        }`)

}

/** Keep the renderer's submit/restore engine; supply the browser's follow-up policy. */
export function useBrowserFollowupSubmit(source: string, root: string): string {
  const start = '  const submitDraft = () => {'
  const policy = JSON.stringify(path.join(root, 'src/experience/followup-preferences'))
  return `import { browserFollowupMode } from ${policy}\n` + replaceBrowserContract(source, [
    [start, '  const submitDraft = (browserAlternate = false) => {'],
    ['const submitWhileBusy = (text: string, payloadPresent: boolean, blockingPrompt: boolean) => {', 'const submitWhileBusy = (text: string, payloadPresent: boolean, blockingPrompt: boolean, browserAlternate: boolean) => {'],
    ['submitWhileBusy(text, payloadPresent, blockingPrompt)', 'submitWhileBusy(text, payloadPresent, blockingPrompt, browserAlternate)'],
    ["if (busyInputMode === 'queue') {", "if (browserFollowupMode(browserAlternate) === 'queue') {"],
    ["} else if (busyInputMode !== null) {\n        steerDraft(busyInputMode)", "} else {\n        steerDraft('interrupt')"]
  ])
}

export function useBrowserAlternateSubmit(source: string, root: string): string {
  const start = source.indexOf("    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.shiftKey) {")
  const end = source.indexOf("    if (event.key === 'Enter' && !event.shiftKey) {", start)
  if (start < 0 || end < 0) throw new Error('Browser alternate composer submit boundary changed')
  const keyboard = source.slice(start, end)
  if (keyboard.split('        queueDraft()').length !== 2) throw new Error('Browser alternate composer command changed')
  source = source.slice(0, start) + keyboard.replace('        queueDraft()', '        submitDraft(true)') + source.slice(end)
  const policy = JSON.stringify(path.join(root, 'src/experience/followup-preferences'))
  return replaceBrowserContract(source, [
    ["import { useBusyInputMode } from '@/app/session/hooks/use-busy-input-mode'", `import { useFollowupBehavior } from ${policy}`],
    [`  const busyInputMode = useBusyInputMode({\n    sessionId: sessionId ?? null,\n    storedSessionId: queueSessionKey ?? null,\n    requestGateway: requestBusyConfig\n  })`, '  const busyInputMode = useFollowupBehavior()']
  ])
}

export function removeBrowserConversationalVoiceEntry(source: string): string {
  const start = source.indexOf('export function StartVoiceButton(')
  if (start < 0) throw new Error('Browser conversational voice button boundary changed')
  return 'export function StartVoiceButton(_props: { disabled: boolean; label: string; onStart: () => void }) {\n  return null\n}\n'
}

export function useBrowserCodingActionHooks(source: string): string {
  return replaceBrowserContract(source, [
    ['{resolvedRepoPath && (\n              <div ', '{resolvedRepoPath && (\n              <div data-browser-coding-path="" '],
    ['className="pointer-events-none size-4 shrink-0 text-muted-foreground/50', 'className="browser-copy-path-action pointer-events-none size-4 shrink-0 text-muted-foreground/50'],
    ['aria-label={s.newBranch}', 'data-browser-coding-action="branch" aria-label={s.newBranch}']
  ])
}
