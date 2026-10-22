import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: 'test',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    headless: true,
    viewport: { width: 1200, height: 800 },
  },
});
