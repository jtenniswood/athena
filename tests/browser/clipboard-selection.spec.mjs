import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application, origin
test.beforeAll(async () => { application = await createBuiltApplication(); origin = application.origin })
test.afterAll(async () => { await application?.close() })
const composer = page => page.locator('[data-slot="composer-rich-input"]:visible').first()
const payload = 'Exact copied text\n  with spacing and 世界\n'

for (const mode of ['denied', 'unavailable']) {
  test.describe(`Clipboard API ${mode}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(mode => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'denied' ? {
          writeText: async () => { window.nativeWriteAttempts = (window.nativeWriteAttempts ?? 0) + 1; throw new Error('Permission denied') }
        } : undefined })
        window.fallbackCopies = []
        const original = document.execCommand
        // Observe the browser's real selected payload without needing OS clipboard permission.
        document.execCommand = function (command, ...args) {
          if (command !== 'copy') return original?.call(this, command, ...args)
          const active = document.activeElement
          const text = typeof active?.selectionStart === 'number'
            ? active.value.slice(active.selectionStart, active.selectionEnd) : window.getSelection()?.toString()
          window.fallbackCopies.push({ text, insideDialog: Boolean(active?.closest('[role="dialog"]')) })
          return window.copyAllowed !== false
        }
      }, mode)
      await page.goto(`${origin}/#/preview-week`)
      await expect(composer(page)).toBeVisible({ timeout: 30000 })
    })

    test('fallback copy restores the composer selection on success and failure', async ({ page }) => {
      for (const allowed of [true, false]) {
        const editor = composer(page)
        await editor.fill('Before selected after')
        const result = await editor.evaluate(async (editor, { allowed, payload }) => {
          editor.focus()
          const range = document.createRange()
          range.setStart(editor.firstChild, 7); range.setEnd(editor.firstChild, 15)
          const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
          window.copyAllowed = allowed
          let ok, error
          try { ok = await window.hermesDesktop.writeClipboard(payload) }
          catch (failure) { error = failure.message }
          return { ok, error, focused: document.activeElement === editor, selected: window.getSelection().toString(),
            copied: window.fallbackCopies.at(-1), attempts: window.nativeWriteAttempts ?? 0 }
        }, { allowed, payload })
        expect(result.copied).toEqual({ text: payload, insideDialog: false })
        expect(result.focused).toBe(true)
        expect(result.selected).toBe('selected')
        if (allowed) expect(result.ok).toBe(true)
        else expect(result.error).toMatch(/copy/i)
        expect(result.attempts).toBe(mode === 'denied' ? (allowed ? 1 : 2) : 0)
        await editor.press('z')
        await expect(editor).toHaveText('Before z after')
      }
      await page.reload()
      await expect(composer(page)).toHaveText('Before z after')
    })

    test('fallback copy remains inside a real dialog focus scope', async ({ page }) => {
      await composer(page).fill('Keep the original conversation draft')
      await page.getByRole('button', { name: 'Chat actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Rename session', exact: true })
      const input = dialog.getByRole('textbox', { name: 'Rename session', exact: true })
      await expect(input).toBeFocused()
      const result = await input.evaluate(async (input, payload) => {
        input.setSelectionRange(2, 7)
        const ok = await window.hermesDesktop.writeClipboard(payload)
        return { ok, copied: window.fallbackCopies.at(-1), focused: document.activeElement === input,
          selection: [input.selectionStart, input.selectionEnd] }
      }, payload)
      expect(result).toEqual({ ok: true, copied: { text: payload, insideDialog: true }, focused: true, selection: [2, 7] })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(composer(page)).toHaveText('Keep the original conversation draft')
    })
  })
}
