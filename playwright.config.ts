import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', timeout: 30000, workers: 1, reporter: 'list',
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3002', headless: true },
  projects: [
    { name: 'desktop-chromium', testMatch: 'workflow.spec.ts', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
    { name: 'mobile-chromium', testMatch: 'mobile.spec.ts', use: { ...devices['iPhone 13'], browserName: 'chromium', channel: 'chromium' } },
    { name: 'mobile-webkit', testMatch: 'mobile.spec.ts', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
