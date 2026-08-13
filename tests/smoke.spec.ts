import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const openPortfolio = async (page: Page) => {
	await page.goto('/');
	await expect(page.locator('[data-page-loader]')).toHaveCount(0);
	await expect(page.locator('html')).not.toHaveAttribute('data-page-loading', 'true');
};

test.describe('mobile navigation', () => {
	test.use({
		viewport: { width: 390, height: 844 },
		hasTouch: true,
	});

	test('opens and closes with keyboard and touch without stealing focus', async ({ page }) => {
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

		const themeToggle = page.locator('[data-theme-toggle]');
		await themeToggle.focus();
		await page.keyboard.press('Escape');
		await expect(themeToggle).toBeFocused();

		await toggle.tap();
		await page.getByRole('link', { name: 'Projects' }).tap();
		await expect(menu).toHaveAttribute('data-open', 'false');
		await expect(page).toHaveURL(/#projects$/);
	});
});

test('persists the selected theme across reloads', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	await openPortfolio(page);

	const root = page.locator('html');
	const toggle = page.locator('[data-theme-toggle]');
	await expect(root).toHaveAttribute('data-theme', 'dark');
	await expect(root).toHaveAttribute('data-theme-preference', 'system');

	await toggle.click();
	await expect(root).toHaveAttribute('data-theme', 'light');
	await expect(root).toHaveAttribute('data-theme-preference', 'user');
	await expect(toggle).toHaveAccessibleName('Switch to dark mode');
	await expect.poll(() => page.evaluate(() => localStorage.getItem('portfolio-theme'))).toBe('light');

	await page.reload();
	await expect(page.locator('[data-page-loader]')).toHaveCount(0);
	await expect(root).toHaveAttribute('data-theme', 'light');
	await expect(root).toHaveAttribute('data-theme-preference', 'user');
});

test('uses reduced-motion fallbacks for page and component animation', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	await openPortfolio(page);

	const root = page.locator('html');
	await expect.poll(() => root.evaluate((element) => getComputedStyle(element).scrollBehavior)).toBe('auto');
	await expect.poll(() => page.locator('.hero__scroll-icon').evaluate(
		(element) => getComputedStyle(element).animationName,
	)).toBe('none');
	await expect.poll(() => page.locator('[data-project-slide]').first().evaluate(
		(element) => getComputedStyle(element).transitionDuration,
	)).toBe('0s');

	await page.locator('[data-theme-toggle]').click();
	await expect(root).toHaveAttribute('data-theme', 'light');
	await expect(root).not.toHaveAttribute('data-theme-transition', 'true');
	await expect(page.locator('.theme-transition-cover')).toHaveCount(0);
});

test.describe('theme reveal', () => {
	test('completes and cleans up the full-page transition', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
		await openPortfolio(page);

		const root = page.locator('html');
		const toggle = page.locator('[data-theme-toggle]');
		await toggle.click();
		await expect(root).toHaveAttribute('data-theme-transition', 'true');
		await expect(root).toHaveAttribute('data-theme', 'light');
		await expect(root).not.toHaveAttribute('data-theme-transition', 'true');
		await expect(toggle).not.toHaveAttribute('aria-busy', 'true');
		await expect(page.locator('.theme-transition-cover')).toHaveCount(0);
	});
});

test('updates project deck state with keyboard, buttons, and pointer drag', async ({ page }) => {
	await openPortfolio(page);

	const deck = page.locator('[data-project-deck]');
	const slides = deck.locator('[data-project-slide]');
	const next = deck.locator('[data-project-next]');
	const previous = deck.locator('[data-project-previous]');
	const status = deck.locator('[data-project-status]');

	await slides.nth(0).locator('[data-project-gallery]').focus();
	await page.keyboard.press('ArrowRight');
	await expect(deck).toHaveAttribute('data-active-index', '1');
	await expect(deck).toBeFocused();
	await expect(slides.nth(1)).toHaveAttribute('aria-current', 'true');
	await expect(slides.nth(0).locator('[data-project-content]')).toHaveAttribute('inert', '');
	await expect(status).toHaveText(/Showing project 2 of 4: Self-Hosted Homelab/);

	await next.click();
	await expect(deck).toHaveAttribute('data-active-index', '2');
	await expect(deck.locator('[data-project-position]')).toHaveText('03 / 04');
	await previous.click();
	await expect(deck).toHaveAttribute('data-active-index', '1');

	await previous.click();
	await expect(deck).toHaveAttribute('data-active-index', '0');
	const bounds = await deck.boundingBox();
	expect(bounds).not.toBeNull();
	if (!bounds) return;

	await page.mouse.move(bounds.x + bounds.width * 0.75, bounds.y + bounds.height * 0.5);
	await page.mouse.down();
	await page.mouse.move(bounds.x + bounds.width * 0.25, bounds.y + bounds.height * 0.5, { steps: 5 });
	await page.mouse.up();
	await expect(deck).toHaveAttribute('data-active-index', '1');
});

test('updates gallery controls and announces the current image', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await openPortfolio(page);

	const activeSlide = page.locator('[data-project-slide][aria-current="true"]');
	const gallery = activeSlide.locator('[data-project-gallery]');
	const frames = gallery.locator('.project-card__image-frame');
	const previous = activeSlide.locator('[data-gallery-previous]');
	const next = activeSlide.locator('[data-gallery-next]');
	const status = activeSlide.locator('[data-gallery-status]');

	await expect(gallery).toHaveAttribute('data-active-index', '0');
	await expect(frames.nth(0)).toHaveAttribute('aria-current', 'true');
	await next.click();
	await expect(gallery).toHaveAttribute('data-active-index', '1');
	await expect(frames.nth(1)).toHaveAttribute('aria-current', 'true');
	await expect(previous).toBeEnabled();
	await expect(next).toBeDisabled();
	await expect(status).toHaveText(/Showing image 2 of 2: Touch of Beauty admin dashboard/);
	await expect.poll(() => gallery.evaluate((element) => {
		const target = element.querySelectorAll<HTMLElement>('.project-card__image-frame')[1];
		return Math.abs(element.scrollTop - target.offsetTop);
	})).toBeLessThanOrEqual(1);
	await expect(status).toHaveText(/Showing image 2 of 2: Touch of Beauty admin dashboard/);

	await previous.click();
	await expect(gallery).toHaveAttribute('data-active-index', '0');
	await expect(previous).toBeDisabled();
});

test('traps dialog focus and returns it to the privacy trigger', async ({ page }) => {
	await openPortfolio(page);

	const trigger = page.getByRole('button', { name: 'Privacy and data notice' });
	const dialog = page.getByRole('dialog', { name: 'Privacy & data notice' });
	const title = page.locator('[data-privacy-title]');

	await trigger.click();
	await expect(dialog).toBeVisible();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	await expect(title).toBeFocused();

	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(trigger).toBeFocused();

	await trigger.press('Enter');
	await page.getByRole('button', { name: 'Close privacy notice' }).click();
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();
});

test('back-to-top preserves the fragment and moves logical focus', async ({ page }) => {
	await openPortfolio(page);

	const backToTop = page.locator('[data-back-to-top]');
	await backToTop.scrollIntoViewIfNeeded();
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
	await backToTop.click();

	await expect(page).toHaveURL(/#home$/);
	await expect(page.locator('#home')).toBeFocused();
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('has no automatically detectable WCAG A or AA violations', async ({ page }) => {
	await openPortfolio(page);

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa'])
		.analyze();

	expect(results.violations).toEqual([]);
});

test.describe('page loader', () => {
	test('makes page controls inert until the reveal completes', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.goto('/', { waitUntil: 'domcontentloaded' });

		const loader = page.locator('[data-page-loader]');
		const navbar = page.locator('[data-navbar]');
		await expect(loader).toBeVisible();
		await expect(navbar).toHaveAttribute('inert', '');
		await expect(loader).toHaveCount(0, { timeout: 3_000 });
		await expect(navbar).not.toHaveAttribute('inert', '');
	});
});
