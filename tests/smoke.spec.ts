import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const openPortfolio = async (page: Page) => {
	await page.goto('/');
	await expect(page.locator('[data-page-loader]')).toHaveCount(0, { timeout: 10_000 });
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
	const activeSlide = page.locator('[data-project-slide][aria-current="true"]');
	const gallery = activeSlide.locator('[data-project-gallery]');
	await expect.poll(() => root.evaluate((element) => getComputedStyle(element).scrollBehavior)).toBe('auto');
	await expect.poll(() => page.locator('.hero__scroll-icon').evaluate(
		(element) => getComputedStyle(element).animationName,
	)).toBe('none');
	await expect.poll(() => page.locator('[data-project-slide]').first().evaluate(
		(element) => getComputedStyle(element).transitionDuration,
	)).toBe('0s');
	await expect.poll(() => activeSlide.locator('.project-card__media-track').evaluate(
		(element) => getComputedStyle(element).animationName,
	)).toBe('none');
	await expect.poll(() => activeSlide.locator('.project-card__stack li').first().evaluate(
		(element) => getComputedStyle(element, '::before').transitionDuration,
	)).toBe('0s');
	await expect.poll(() => page.locator('kinetic-text').evaluate((element) => {
		const engine = (element as HTMLElement & {
			engine?: { reducedMotion: boolean; running: boolean };
		}).engine;
		return { reducedMotion: engine?.reducedMotion, running: engine?.running };
	})).toEqual({ reducedMotion: true, running: false });

	const heading = page.locator('[data-scramble-heading]').first();
	const canonicalHeading = await heading.getAttribute('data-scramble-text');
	await page.waitForTimeout(120);
	await expect(heading).toHaveText(canonicalHeading ?? '');

	const galleryPosition = await gallery.evaluate((element) => {
		const next = element.closest('.project-card__media-shell')
			?.querySelector<HTMLButtonElement>('[data-gallery-next]');
		next?.click();
		const target = element.querySelectorAll<HTMLElement>('.project-card__image-frame')[1];
		return {
			activeIndex: element.dataset.activeIndex,
			distance: Math.abs(element.scrollTop - target.offsetTop),
			hasHint: element.hasAttribute('data-gallery-hinting'),
		};
	});
	expect(galleryPosition.activeIndex).toBe('1');
	expect(galleryPosition.distance).toBeLessThanOrEqual(1);
	expect(galleryPosition.hasHint).toBe(false);

	const privacyTrigger = page.getByRole('button', { name: 'Privacy and data notice' });
	const privacyDialog = page.getByRole('dialog', { name: 'Privacy & data notice' });
	await privacyTrigger.click();
	await expect(privacyDialog).toBeVisible();
	expect(await privacyDialog.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(0);
	await page.getByRole('button', { name: 'Close privacy notice' }).click();
	await expect(privacyDialog).toBeHidden();

	await page.locator('[data-theme-toggle]').click();
	await expect(root).toHaveAttribute('data-theme', 'light');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(244, 243, 239)');
	await expect(root).not.toHaveAttribute('data-theme-transition', 'true');
	await expect(page.locator('.theme-transition-cover')).toHaveCount(0);
	await expect.poll(() => root.evaluate(
		(element) => element.style.getPropertyValue('--theme-wave-x'),
	)).toBe('');
	await page.locator('[data-theme-toggle]').click();
	await expect(root).toHaveAttribute('data-theme', 'dark');
	await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 11, 12)');
	await expect(root).not.toHaveAttribute('data-theme-transition', 'true');
});

test.describe('theme reveal', () => {
	test('starts at the toggle, covers the viewport, and cleans up', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
		await openPortfolio(page);

		const root = page.locator('html');
		const toggle = page.locator('[data-theme-toggle]');
		const bounds = await toggle.boundingBox();
		expect(bounds).not.toBeNull();
		await toggle.click();
		await expect(root).toHaveAttribute('data-theme-transition', 'true');

		const geometry = await root.evaluate((element) => ({
			x: Number.parseFloat(element.style.getPropertyValue('--theme-wave-x')),
			y: Number.parseFloat(element.style.getPropertyValue('--theme-wave-y')),
			radius: Number.parseFloat(element.style.getPropertyValue('--theme-wave-radius')),
			width: window.innerWidth,
			height: window.innerHeight,
		}));
		if (bounds) {
			const expectedX = bounds.x + bounds.width / 2;
			const expectedY = bounds.y + bounds.height / 2;
			const farthestCorner = Math.hypot(
				Math.max(expectedX, geometry.width - expectedX),
				Math.max(expectedY, geometry.height - expectedY),
			);
			expect(geometry.x).toBeCloseTo(expectedX, 0);
			expect(geometry.y).toBeCloseTo(expectedY, 0);
			expect(geometry.radius).toBeGreaterThan(farthestCorner);
			expect(geometry.radius).toBeLessThanOrEqual(Math.ceil(farthestCorner) + 1);
		}

		await expect(root).toHaveAttribute('data-theme', 'light');
		await expect(root).not.toHaveAttribute('data-theme-transition', 'true');
		await expect(toggle).not.toHaveAttribute('aria-busy', 'true');
		await expect(page.locator('.theme-transition-cover')).toHaveCount(0);
		await expect.poll(() => root.evaluate((element) => [
			element.style.getPropertyValue('--theme-wave-x'),
			element.style.getPropertyValue('--theme-wave-y'),
			element.style.getPropertyValue('--theme-wave-radius'),
		])).toEqual(['', '', '']);

		await toggle.click();
		await expect(root).toHaveAttribute('data-theme-transition', 'true');
		await expect(root).toHaveAttribute('data-theme', 'dark');
		await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(9, 11, 12)');
		await expect(root).not.toHaveAttribute('data-theme-transition', 'true');
		await expect(toggle).toHaveAccessibleName('Switch to light mode');
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
		await expect(root).toHaveAttribute('data-theme-transition', 'true');
		await expect(cover).toBeVisible();
		await expect(cover).toHaveAttribute('data-theme', 'light');
		await expect(root).toHaveAttribute('data-theme', 'light');
		await expect(root).not.toHaveAttribute('data-theme-transition', 'true');
		await expect(cover).toHaveCount(0);
	});

	test('finishes immediately when reduced motion is enabled mid-reveal', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
		await openPortfolio(page);

		const root = page.locator('html');
		const toggle = page.locator('[data-theme-toggle]');
		await toggle.click();
		await expect(root).toHaveAttribute('data-theme-transition', 'true');
		await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
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

test('shows role, challenge, and outcome details for every project', async ({ page }) => {
	await openPortfolio(page);

	const slides = page.locator('[data-project-slide]');
	await expect(slides).toHaveCount(4);

	for (const slide of await slides.all()) {
		const impact = slide.locator('[data-project-impact]');
		await expect(impact).toHaveCount(1);

		for (const [key, label] of [
			['role', 'Role'],
			['challenge', 'Challenge'],
			['outcome', 'Outcome'],
		] as const) {
			const detail = impact.locator(`[data-project-detail="${key}"]`);
			await expect(detail.locator('dt')).toHaveText(label);
			await expect(detail.locator('dd')).not.toHaveText(/^\s*$/);
		}
	}
	for (const width of [1_200, 1_280]) {
		await page.setViewportSize({ width, height: 720 });
		const overflow = await slides.evaluateAll((elements) => elements.map((element) => {
			const copy = element.querySelector<HTMLElement>('.project-card__copy');
			return copy ? copy.scrollHeight - copy.clientHeight : Number.POSITIVE_INFINITY;
		}));
		expect(
			Math.max(...overflow),
			`Project copy overflow at ${width}px by slide: ${overflow.join(', ')}px`,
		).toBeLessThanOrEqual(1);
	}
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
