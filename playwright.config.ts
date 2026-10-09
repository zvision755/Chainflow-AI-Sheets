import { defineConfig, devices } from '@playwright/test';
const chromiumChannel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL === 'chrome' ? 'chrome' : 'chromium';
export default defineConfig({
  testDir: './tests/ui', timeout: 30000, workers: 1, reporter: 'list',
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3002', headless: true },
  projects: [
    { name: 'server-auth', testMatch: 'server-mode.spec.ts', use: { ...devices['Desktop Chrome'], channel: chromiumChannel,baseURL:'http://127.0.0.1:3006/' } },
    { name: 'web-mobile', testMatch: 'web-mobile.spec.ts', use: { ...devices['iPhone 13'],browserName:'chromium', channel:chromiumChannel,baseURL:process.env.WEB_TEST_URL??'http://127.0.0.1:3005/Chainflow-AI-Sheets/' } },
    { name: 'web', testMatch: 'web.spec.ts', use: { ...devices['Desktop Chrome'], channel: chromiumChannel,baseURL:process.env.LOCAL_STATIC_URL??'http://127.0.0.1:3005/Chainflow-AI-Sheets/' } },
    { name: 'desktop-chromium', testMatch: 'workflow.spec.ts', use: { ...devices['Desktop Chrome'], channel: chromiumChannel } },
    { name: 'mobile-chromium', testMatch: 'mobile.spec.ts', use: { ...devices['iPhone 13'], browserName: 'chromium', channel: chromiumChannel } },
    { name: 'mobile-webkit', testMatch: 'mobile.spec.ts', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
