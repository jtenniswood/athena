import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/browser',
  workers: 1,
  timeout: 45000,
  use: { headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'chromium', testIgnore: /webkit\.spec\.mjs$/, use: { browserName: 'chromium' } },
    { name: 'webkit', testMatch: /(?:webkit|gateway-setup|sign-in|sign-in-credentials|transition-portals|cold-connection-recovery|scheduled-profile-scope|mobile-chat-history|new-chat-profile|timeline-scrubbing|composer-keyboard|display-scale|external-links|browser-windows|clipboard-selection|ambient-claims|file-picker|plugin-files|plugin-discovery|sidebar-gestures|session-routing|plugin-notifications)\.spec\.mjs$/, use: { browserName: 'webkit' } }
  ],
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
    ['json', { outputFile: 'playwright-report/results.json' }]
  ]
})
