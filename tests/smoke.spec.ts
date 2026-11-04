import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { siteConfig } from '../src/config/site.js';

type RuntimeIssues = {
	pageErrors: string[];
	consoleErrors: string[];
};

const runtimeIssuesByPage = new WeakMap<Page, RuntimeIssues>();

test.beforeEach(({ context, page }) => {
	const issues: RuntimeIssues = {
		pageErrors: [],
		consoleErrors: [],
	};
	const monitorPage = (monitoredPage: Page) => {
		monitoredPage.on('pageerror', (error) => {
			issues.pageErrors.push(error.stack ?? error.message);
		});
		monitoredPage.on('console', (message) => {
			if (!['error', 'assert'].includes(message.type())) return;

			const location = message.location();
			const source = location.url
				? ` (${location.url}:${location.lineNumber + 1}:${location.columnNumber + 1})`
				: '';
			issues.consoleErrors.push(`${message.type()}: ${message.text()}${source}`);
		});
	};

	monitorPage(page);
	context.on('page', monitorPage);
	runtimeIssuesByPage.set(page, issues);
});

test.afterEach(({ page }) => {
	const issues = runtimeIssuesByPage.get(page);
	expect.soft(
		issues?.pageErrors ?? [],
		'The page emitted uncaught JavaScript errors.',
	).toEqual([]);
	expect.soft(
		issues?.consoleErrors ?? [],
		'The page emitted unexpected console errors.',
	).toEqual([]);
});

const openPage = async (page: Page, path: string) => {
	await page.goto(path);
	await expect(page.locator('[data-page-loader]')).toHaveCount(0, { timeout: 10_000 });
	await expect(page.locator('html')).not.toHaveAttribute('data-page-loading', 'true');
};

const openPortfolio = (page: Page) => openPage(page, '/');

test('production security headers preserve theme initialization and the page loader', async ({ page }) => {
	const productionHeaders = Object.fromEntries(
		Object.entries(siteConfig.responseHeaders)
			.map(([name, value]) => [name.toLowerCase(), value]),
	);
	const cspViolations: string[] = [];

	page.on('console', (message) => {
		if (/content security policy|refused to/i.test(message.text())) {
			cspViolations.push(message.text());
		}
	});
	await page.route('**/*', async (route) => {
		const response = await route.fetch();
		const headers = response.headers();

		if (headers['content-type']?.includes('text/html')) {
			Object.assign(headers, productionHeaders);
		}

		await route.fulfill({ response, headers });
	});
	await page.addInitScript(() => localStorage.setItem('portfolio-theme', 'light'));

	const response = await page.goto('/');
	expect(response?.headers()['content-security-policy']).toBe(
		siteConfig.responseHeaders['Content-Security-Policy'],
	);
	await expect(page.locator('[data-page-loader]')).toHaveCount(0, { timeout: 10_000 });
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	await page.locator('[data-theme-toggle]').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await page.goto('/404.html');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.locator('[data-page-loader]')).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	expect(cspViolations).toEqual([]);
});

test.describe('mobile navigation', () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
	});

	test('opens and closes with keyboard and touch', async ({ page }) => {
		await openPortfolio(page);

		const toggle = page.locator('[data-menu-toggle]');
		const menu = page.locator('[data-navigation-menu]');
		await toggle.focus();
		await page.keyboard.press('Enter');
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(menu).toHaveAttribute('data-open', 'true');

		await page.keyboard.press('Escape');
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(toggle).toBeFocused();

		await toggle.tap();
		await page.getByRole('link', { name: 'Projekty' }).tap();
		await expect(menu).toHaveAttribute('data-open', 'false');
		await expect(page).toHaveURL(/#projects$/);
	});
});

test('persists the selected theme across reloads', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	await openPortfolio(page);

	const root = page.locator('html');
	await expect(root).toHaveAttribute('data-theme', 'dark');

	await page.locator('[data-theme-toggle]').click();
	await expect(root).toHaveAttribute('data-theme', 'light');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 243, 239)');

	await page.reload();
	await expect(page.locator('[data-page-loader]')).toHaveCount(0);
	await expect(root).toHaveAttribute('data-theme', 'light');
});

for (const viewport of [
	{ label: 'mobile', width: 390, height: 844 },
	{ label: 'desktop', width: 1_440, height: 900 },
]) {
	test(`${viewport.label} pages load images without horizontal overflow`, async ({ page }) => {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });

		for (const path of ['/', '/en/', '/404.html']) {
			await openPage(page, path);

			const brokenImages = await page.locator('img').evaluateAll(async (elements) => {
				const images = elements as HTMLImageElement[];
				await Promise.all(images.map((image) => {
					image.loading = 'eager';
					return image.decode().catch(() => {});
				}));
				return images
					.filter((image) => image.naturalWidth === 0)
					.map((image) => image.currentSrc || image.src);
			});
			expect(brokenImages, `Broken images on ${path}.`).toEqual([]);

			const overflow = await page.evaluate(() => (
				document.documentElement.scrollWidth - document.documentElement.clientWidth
			));
			expect(overflow, `Horizontal overflow on ${path}.`).toBeLessThanOrEqual(1);
		}
	});
}

test.describe('theme reveal', () => {
	test('starts at the toggle and cleans up', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
		await openPortfolio(page);

		const root = page.locator('html');
		const toggle = page.locator('[data-theme-toggle]');
		const bounds = await toggle.boundingBox();
		expect(bounds).not.toBeNull();
		await toggle.click();
		await expect(root).toHaveAttribute('data-theme-transition', 'true');

		const origin = await root.evaluate((element) => ({
			x: Number.parseFloat(element.style.getPropertyValue('--theme-wave-x')),
			y: Number.parseFloat(element.style.getPropertyValue('--theme-wave-y')),
		}));
		expect(origin.x).toBeCloseTo(bounds!.x + bounds!.width / 2, 0);
		expect(origin.y).toBeCloseTo(bounds!.y + bounds!.height / 2, 0);

		await expect(root).toHaveAttribute('data-theme', 'light');
		await expect(root).not.toHaveAttribute('data-theme-transition', 'true');
		await expect(page.locator('.theme-transition-cover')).toHaveCount(0);
	});

	test('uses and cleans up the Web Animations fallback', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(document, 'startViewTransition', {
				configurable: true,
				value: undefined,
			});
		});
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
		await openPortfolio(page);

		const root = page.locator('html');
		const cover = page.locator('.theme-transition-cover');
		await page.locator('[data-theme-toggle]').click();
		await expect(cover).toBeVisible();
		await expect(root).toHaveAttribute('data-theme', 'light');
		await expect(root).not.toHaveAttribute('data-theme-transition', 'true');
		await expect(cover).toHaveCount(0);
	});
});

test('updates project deck state with keyboard, buttons, and pointer drag', async ({ page }) => {
	await openPortfolio(page);

	const deck = page.locator('[data-project-deck]');
	const slides = deck.locator('[data-project-slide]');
	const next = deck.locator('[data-project-next]');
	const previous = deck.locator('[data-project-previous]');

	await slides.nth(0).locator('[data-project-gallery]').focus();
	await page.keyboard.press('ArrowRight');
	await expect(deck).toHaveAttribute('data-active-index', '1');
	await expect(slides.nth(1)).toHaveAttribute('aria-current', 'true');
	await expect(slides.nth(0).locator('[data-project-content]')).toHaveAttribute('inert', '');

	await next.click();
	await expect(deck).toHaveAttribute('data-active-index', '2');
	await previous.click();
	await previous.click();
	await expect(deck).toHaveAttribute('data-active-index', '0');

	const bounds = await deck.boundingBox();
	expect(bounds).not.toBeNull();
	await page.mouse.move(bounds!.x + bounds!.width * 0.75, bounds!.y + bounds!.height * 0.5);
	await page.mouse.down();
	await page.mouse.move(bounds!.x + bounds!.width * 0.25, bounds!.y + bounds!.height * 0.5, { steps: 5 });
	await page.mouse.up();
	await expect(deck).toHaveAttribute('data-active-index', '1');
});

test('updates gallery controls and announces the current image', async ({ page }) => {
	await openPortfolio(page);

	const activeSlide = page.locator('[data-project-slide][aria-current="true"]');
	const gallery = activeSlide.locator('[data-project-gallery]');
	const previous = activeSlide.locator('[data-gallery-previous]');
	const next = activeSlide.locator('[data-gallery-next]');

	await next.click();
	await expect(gallery).toHaveAttribute('data-active-index', '1');
	await expect(next).toBeDisabled();
	const description = await gallery.locator('img').nth(1).getAttribute('alt');
	await expect(activeSlide.locator('[data-gallery-status]')).toContainText(description ?? '');

	await previous.click();
	await expect(gallery).toHaveAttribute('data-active-index', '0');
	await expect(previous).toBeDisabled();
});

test('traps dialog focus and returns it to the privacy trigger', async ({ page }) => {
	await openPortfolio(page);

	const trigger = page.getByRole('button', { name: 'Informacja o prywatności i danych' });
	const dialog = page.getByRole('dialog', { name: 'Prywatność i dane' });

	await trigger.click();
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-privacy-title]')).toBeFocused();

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();
});

test('renders the custom 404 with noindex metadata and a recovery link', async ({ page }) => {
	await openPage(page, '/404.html');

	await expect(page).toHaveTitle('Nie znaleziono strony | Adam Salicki');
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
	await expect(page.getByRole('link', { name: 'Wróć do portfolio' })).toHaveAttribute('href', '/');
});

for (const path of ['/', '/404.html']) {
	test(`${path} has no automatically detectable WCAG A or AA violations`, async ({ page }) => {
		await openPage(page, path);

		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
			.analyze();

		expect(results.violations).toEqual([]);
	});
}

test('makes page controls inert until the loader reveal completes', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.goto('/', { waitUntil: 'domcontentloaded' });

	const loader = page.locator('[data-page-loader]');
	const navbar = page.locator('[data-navbar]');
	await expect(loader).toBeVisible();
	await expect(navbar).toHaveAttribute('inert', '');
	await expect(loader).toHaveCount(0, { timeout: 10_000 });
	await expect(navbar).not.toHaveAttribute('inert', '');
});

test('serves Polish at / and English under /en/', async ({ page }) => {
	await openPortfolio(page);
	await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
	await expect(page.getByRole('link', { name: 'Napisz na kontakt.asalicki@protonmail.com' }))
		.toHaveAttribute('href', 'mailto:kontakt.asalicki@protonmail.com');

	await openPage(page, '/en/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByRole('link', { name: 'Email contact.asalicki@protonmail.com' }))
		.toHaveAttribute('href', 'mailto:contact.asalicki@protonmail.com');
	await expect(page.locator('link[rel="alternate"][hreflang="pl"]'))
		.toHaveAttribute('href', 'https://adamsalicki.pages.dev/');
});

test('remembers the language chosen in the footer', async ({ page }) => {
	await openPortfolio(page);
	await page.getByRole('link', { name: 'Zmień język na angielski' }).click();
	await expect(page).toHaveURL('/en/');

	await page.goto('/');
	await expect(page).toHaveURL('/en/');

	await page.getByRole('link', { name: 'Switch language to Polish' }).click();
	await expect(page).toHaveURL('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
});

test.describe('English device language', () => {
	test.use({ locale: 'en-US' });

	test('redirects the canonical route and localizes the shared 404', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL('/en/');

		await page.goto('/404.html');
		await expect(page).toHaveTitle('Page not found | Adam Salicki');
	});

	test('honors an explicit Polish choice when browser storage is unavailable', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(window, 'localStorage', {
				get() { throw new DOMException('Storage blocked', 'SecurityError'); },
			});
		});
		await openPage(page, '/?lang=pl&ref=shared#about');
		await expect(page).toHaveURL('/?ref=shared#about');
		await expect(page.locator('html')).toHaveAttribute('lang', 'pl');
	});
});
