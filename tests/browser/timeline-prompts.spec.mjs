import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test('the conversation timeline keeps only user prompts from loaded and indexed history', async ({ page }) => {
  const application = await createBuiltApplication()
  try {
    const rows = application.gateway.messages.get('preview-week')
    const timestamp = rows.at(-1).timestamp
    const generated = "You've reached the maximum number of tool-calling iterations allowed. Please provide a final response summarizing what you've found and accomplished so far, without calling any more tools."
    rows.push(
      { id: 20, role: 'user', content: generated, timestamp: timestamp + 1 },
      { id: 21, role: 'assistant', content: 'Here is what I finished.', timestamp: timestamp + 2 },
      { id: 22, role: 'user', content: 'Help me summarize what changed.', timestamp: timestamp + 3 }
    )
    await page.route('**/api/sessions/preview-week/timeline?**', route => route.fulfill({ json: {
      entries: [
        { row_id: 10, preview: 'An earlier user question.' },
        { row_id: 11, preview: generated.slice(0, 119).trimEnd() + '…' }
      ],
      pagination: { has_more: false, next_cursor: null }
    } }))
    await page.goto(application.origin + '/#/preview-week')
    const ticks = page.getByRole('navigation', { name: 'Conversation timeline' }).getByRole('button')
    await expect(ticks).toHaveCount(3)
    expect(await ticks.evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')))).toEqual([
      'An earlier user question.',
      'Help me make a thoughtful plan.',
      'Help me summarize what changed.'
    ])
    await expect(page.getByText('Here is what I finished.', { exact: true })).toBeVisible()
  } finally {
    await application.close()
  }
})

test('jumping from a timeline tick aligns its prompt at the default display scale', async ({ page }) => {
  const application = await createBuiltApplication()
  try {
    const rows = application.gateway.messages.get('preview-week')
    const timestamp = rows.at(-1).timestamp
    for (let index = 0; index < 8; index++) {
      rows.push(
        { id: 20 + index * 2, role: 'user', content: `Timeline prompt ${index}`, timestamp: timestamp + index * 2 + 1 },
        { id: 21 + index * 2, role: 'assistant', content: 'A paragraph with room to scroll.\n\n'.repeat(16), timestamp: timestamp + index * 2 + 2 }
      )
    }

    await page.goto(application.origin + '/#/preview-week')
    await expect.poll(() => page.evaluate(() => document.documentElement.style.zoom)).toBe('1.25')
    const tick = page.getByRole('button', { name: 'Timeline prompt 3', exact: true })
    const viewport = page.locator('[data-slot="aui_thread-viewport"]:visible')
    const turn = viewport.locator('[data-slot="aui_turn-pair"]').filter({ hasText: 'Timeline prompt 3' })
    await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBeGreaterThan(1000)
    await tick.click()
    await expect.poll(() => turn.evaluate(element => {
      const viewport = element.closest('[data-slot="aui_thread-viewport"]')
      return Math.abs(element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 8)
    })).toBeLessThan(2)
    await expect(tick).toHaveAttribute('aria-current', 'location')
  } finally {
    await application.close()
  }
})
