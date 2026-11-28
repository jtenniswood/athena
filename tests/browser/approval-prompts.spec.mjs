import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

const sessionId = 'preview-week'
let application

test.beforeAll(async () => {
  application = await createBuiltApplication()
  const history = application.gateway.messages.get(sessionId)
  const start = history.at(-1).timestamp
  for (let index = 0; index < 20; index += 1) {
    history.push({
      id: `approval-history-${index}`,
      role: index % 2 ? 'assistant' : 'user',
      content: `Earlier discussion ${index + 1}`,
      timestamp: start + index + 1
    })
  }
  application.gateway.sessions.get(sessionId).message_count = history.length
})
test.afterAll(async () => { await application?.close() })

for (const width of [1100, 390]) {
  test(`pending command approval is actionable while reading earlier messages at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    let gateway, answer
    const serverRequestId = 'server-approval'
    const requestId = 'queued-approval'
    await page.routeWebSocket(/\/api\/ws/, socket => {
      gateway = socket
      const server = socket.connectToServer()
      socket.onMessage(message => {
        const frame = JSON.parse(String(message))
        if (frame.id === serverRequestId && !frame.method) { answer = frame; return }
        server.send(message)
      })
    })
    await page.goto(`${application.origin}/#/${sessionId}`)
    const editor = page.locator('[data-slot="composer-rich-input"]:visible')
    await expect(editor).toBeVisible({ timeout: 30000 })
    await editor.fill('Keep this unsent draft')
    const viewport = page.locator('[data-slot="aui_thread-viewport"]:visible')
    await expect(viewport).toContainText('Earlier discussion 20')
    await expect.poll(() => viewport.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(100)
    const distanceFromBottom = () => viewport.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)
    await expect(async () => {
      await viewport.evaluate(node => { node.scrollTop = node.scrollHeight })
      expect(await distanceFromBottom()).toBeLessThan(2)
      await expect(viewport).toHaveAttribute('data-following', 'true', { timeout: 1000 })
    }).toPass({ timeout: 10000 })
    // Wheel input cancels the transcript's saved-position restoration.
    await viewport.hover()
    await expect(async () => {
      await page.mouse.wheel(0, -400)
      await expect(viewport).toHaveAttribute('data-following', 'false', { timeout: 1000 })
      expect(await distanceFromBottom()).toBeGreaterThan(100)
    }).toPass({ timeout: 10000 })
    // Browsers apply wheel deltas differently. Position the reader at the top
    // after the gesture has unlocked bottom-follow in the renderer.
    await viewport.evaluate(node => { node.scrollTop = 0 })
    await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeLessThan(2)

    gateway.send(JSON.stringify({
      jsonrpc: '2.0', id: serverRequestId, method: 'approval',
      params: { session_id: sessionId, request_id: requestId, command: 'printf approval-fixture', choices: ['once', 'deny'] }
    }))

    const card = page.locator(`[data-slot="tool-approval-card"][data-request-id="${requestId}"]`)
    await expect(card).toContainText('printf approval-fixture')
    await expect(card.getByRole('button', { name: /^Run/ })).toBeInViewport({ ratio: 1 })
    const reject = card.getByRole('button', { name: 'Reject', exact: true })
    await expect(reject).toBeInViewport({ ratio: 1 })
    await expect.poll(() => reject.evaluate(button => {
      const bounds = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2))
    })).toBe(true)
    expect(await viewport.evaluate(node => node.scrollTop)).toBeLessThan(2)

    await reject.click()
    await expect.poll(() => answer?.result?.choice).toBe('deny')
    await expect(card).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Scroll to bottom/ })).toBeVisible()
    await expect(editor).toHaveText('Keep this unsent draft')
  })
}
