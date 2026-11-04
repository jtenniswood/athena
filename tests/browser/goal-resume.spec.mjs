import { test, expect } from '@playwright/test'
import { createBuiltApplication } from './built-application.mjs'

let application
test.beforeAll(async () => { application = await createBuiltApplication() })
test.afterAll(async () => { await application?.close() })

for (const waiting of [false, true]) {
  for (const expanded of [false, true]) {
    test(`goal header resumes ${waiting ? 'waiting' : 'blocked'} goals when ${expanded ? 'expanded' : 'collapsed'} without losing drafts`, async ({ page }) => {
      await page.setViewportSize({ width: expanded ? 1280 : 390, height: 850 })
      let goal = {
        title: 'Finish the requested changes', status: waiting ? 'active' : 'paused',
        last_verdict: waiting ? 'wait' : 'blocked', turns_used: 3, max_turns: 20,
        contract: { outcome: '', verification: '', constraints: '', boundaries: '', stop_when: '' },
        subgoals: [], gates: [],
        ...(waiting ? { wait_barrier: { type: 'until', until_at: 4102444800, reason: 'Waiting for a dependency' } } : { paused_reason: 'Dependency is now available' })
      }
      let revision = 1, finishAction
      const actions = [], submissions = []
      const control = () => ({ goal, loop: null, heartbeat: null, revision: String(revision), updated_at: revision })
      await page.routeWebSocket(/\/api\/ws/, socket => {
        const server = socket.connectToServer()
        server.onMessage(message => socket.send(message))
        socket.onMessage(message => {
          const frame = JSON.parse(String(message))
          const reply = result => socket.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }))
          if (frame.method === 'session.control.read') return reply({ control: control() })
          if (frame.method === 'session.control') {
            actions.push(frame.params)
            finishAction = () => {
              goal = { ...goal, status: 'active', last_verdict: 'continue', paused_reason: '' }
              delete goal.wait_barrier
              revision++
              reply({ control: control(), dispatch: { type: 'send', message: 'Continue the goal', display: null, output: null, notice: null } })
            }
            return
          }
          if (frame.method === 'prompt.submit') submissions.push(frame.params)
          server.send(message)
        })
      })
      await page.goto(`${application.origin}/#/preview-week`)
      const editor = page.locator('[data-slot="composer-rich-input"]:visible').first()
      await expect(editor).toBeVisible({ timeout: 30000 })
      await editor.fill('Keep this unsent draft')
      const section = page.locator('[data-slot="session-control-goal"]')
      const toggle = section.getByRole('button', { name: /Goal (blocked|waiting)/ })
      if (expanded) await toggle.click()
      await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
      const resume = section.getByRole('button', { name: waiting ? 'Resume now' : 'Resume goal', exact: true })
      await expect(resume).toBeVisible()
      const bounds = await resume.boundingBox()
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(expanded ? 1280 : 390)
      await resume.click()
      await expect(resume).toBeDisabled()
      await expect(resume).toHaveAttribute('aria-busy', 'true')
      await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
      expect(actions).toEqual([{ session_id: 'preview-week', profile: 'default', action: waiting ? 'goal.unwait' : 'goal.resume', args: {} }])
      finishAction()
      await expect(resume).toHaveCount(0)
      await expect.poll(() => submissions.length).toBe(1)
      expect(submissions[0].text).toBe('Continue the goal')
      await expect(editor).toHaveText('Keep this unsent draft')
      await expect(section.getByRole('button', { name: 'Goal actions', exact: true })).toBeVisible()
    })
  }
}
