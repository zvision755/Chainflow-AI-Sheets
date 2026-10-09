import { defineConfig, devices } from '@playwright/test';
const chromiumChannel = process.env.PLAYWRIGHT_CHROMIUM_CHANNEL === 'chrome' ? 'chrome' : 'chromium';
export default defineConfig({
  testDir: './tests/ui', timeout: 30000, workers: 1, reporter: 'list',
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3002', headless: true },
  projects: [
    { name: 'server-auth', testMatch: 'server-mode.spec.ts', use: { ...devices['Desktop Chrome'], channel: chromiumChannel,baseURL:'http://127.0.0.1:3006/' } },
    { name: 'local-mobile-docker', testMatch: 'local-mobile.spec.ts', use: { ...devices['iPhone 13'],browserName:'chromium', channel:chromiumChannel,baseURL:process.env.LOCAL_DOCKER_URL??'http://127.0.0.1:3004/' } },
    { name: 'local-mobile-static', testMatch: 'local-mobile.spec.ts', use: { ...devices['iPhone 13'],browserName:'chromium', channel:chromiumChannel,baseURL:process.env.LOCAL_STATIC_URL??'http://127.0.0.1:3005/Chainflow-AI-Sheets/' } },
    { name: 'local-docker', testMatch: 'local.spec.ts', use: { ...devices['Desktop Chrome'], channel: chromiumChannel,baseURL:process.env.LOCAL_DOCKER_URL??'http://127.0.0.1:3004/' } },
    { name: 'local-static', testMatch: 'local.spec.ts', use: { ...devices['Desktop Chrome'], channel: chromiumChannel,baseURL:process.env.LOCAL_STATIC_URL??'http://127.0.0.1:3005/Chainflow-AI-Sheets/' } },
    { name: 'desktop-chromium', testMatch: 'workflow.spec.ts', use: { ...devices['Desktop Chrome'], channel: chromiumChannel } },
    { name: 'mobile-chromium', testMatch: 'mobile.spec.ts', use: { ...devices['iPhone 13'], browserName: 'chromium', channel: chromiumChannel } },
    { name: 'mobile-webkit', testMatch: 'mobile.spec.ts', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
});
