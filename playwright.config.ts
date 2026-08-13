import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4173';

export default defineConfig({
	testDir: './tests',
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 2 : 0,
	reporter: [
		['list'],
		['html', { open: 'never' }],
	],
	use: {
		baseURL,
		contextOptions: {
			reducedMotion: 'reduce',
		},
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
	},
	webServer: process.env.PLAYWRIGHT_BASE_URL
		? undefined
		: {
			command: 'bunx vite preview --host 127.0.0.1 --port 4173',
			url: baseURL,
			reuseExistingServer: !process.env.CI,
			timeout: 120_000,
		},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] },
		},
		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'] },
		},
		{
			name: 'edge',
			use: { ...devices['Desktop Edge'], channel: 'msedge' },
		},
	],
});
