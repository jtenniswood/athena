import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

test('the conversation timeline keeps only user prompts from loaded and indexed history', async ({ page }) => {
  const application = await createBuiltApplication()
  try {
    const rows = application.gateway.messages.get('preview-week')
    const timestamp = rows.at(-1).timestamp
    const generated = "You've reached the maximum number of tool-calling iterations allowed. Please provide a final response summarizing what you've found and accomplished so far, without calling any more tools."
    const replay = '[STILL IN PROGRESS — this is the active request, restated after the compaction boundary because it was not finished yet. Continue it; do not start over.] Help me make a thoughtful plan.'
    rows.push(
      { id: 20, role: 'user', content: generated, timestamp: timestamp + 1 },
      { id: 21, role: 'assistant', content: 'Here is what I finished.', timestamp: timestamp + 2 },
      { id: 22, role: 'user', content: replay, timestamp: timestamp + 3 },
      { id: 23, role: 'user', content: 'Help me summarize what changed.', timestamp: timestamp + 4 }
    )
    await page.route('**/api/sessions/preview-week/timeline?**', route => route.fulfill({ json: {
      entries: [
        { row_id: 10, preview: 'An earlier user question.' },
        { row_id: 11, preview: generated.slice(0, 119).trimEnd() + '…' },
        { row_id: 12, preview: replay.slice(0, 119).trimEnd() + '…' }
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

test('the timeline condenses to landmarks as more history becomes available', async ({ page }) => {
  const application = await createBuiltApplication()
  try {
    const rows = application.gateway.messages.get('preview-week')
    const timestamp = rows.at(-1).timestamp
    const landmark = 'Pin the rollout checklist before changing the gateway settings.'
    for (let index = 0; index < 8; index++) {
      rows.push(
        { id: 200 + index * 2, role: 'user', content: index === 4 ? landmark : `Follow up ${index}`, timestamp: timestamp + index * 2 + 1 },
        { id: 201 + index * 2, role: 'assistant', content: 'Details about this step.\n\n'.repeat(16), timestamp: timestamp + index * 2 + 2 }
      )
    }

    const historicalLandmark = 'Audit the migration steps and compare the rollback options.'
    const archived = Array.from({ length: 54 }, (_, index) => ({
      row_id: index + 1,
      preview: index === 26 ? historicalLandmark : `Earlier follow-up ${index + 1}`
    }))
    await page.route('**/api/sessions/preview-week/timeline?**', route => {
      const more = new URL(route.request().url()).searchParams.has('after_row_id')
      return route.fulfill({ json: {
        entries: more ? archived.slice(5) : archived.slice(0, 5),
        pagination: { has_more: true, next_cursor: more ? 54 : 5 }
      } })
    })

    await page.goto(application.origin + '/#/preview-week')
    const timeline = page.getByRole('navigation', { name: 'Conversation timeline' })
    const ticks = timeline.getByRole('button')
    await expect(ticks).toHaveCount(15)
    await expect(timeline.getByRole('button', { name: 'Follow up 6', exact: true })).toBeVisible()

    const earlier = timeline.getByRole('button', { name: 'Show earlier messages' })
    await earlier.click()
    await expect(timeline.getByRole('button', { name: historicalLandmark, exact: true })).toBeVisible()
    await expect(ticks).toHaveCount(16)
    await expect(ticks.nth(0)).toHaveAccessibleName('Show earlier messages')
    await expect(ticks.nth(1)).toHaveAccessibleName('Earlier follow-up 1')
    await expect(ticks.last()).toHaveAccessibleName('Follow up 7')
    await expect(timeline.getByRole('button', { name: 'Follow up 6', exact: true })).toHaveCount(0)

    const tick = timeline.getByRole('button', { name: landmark, exact: true })
    await tick.click()
    await expect(tick).toHaveAttribute('aria-current', 'location')
    await expect(page.getByText(landmark, { exact: true })).toBeInViewport()
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
