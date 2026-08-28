import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { siteConfig } from '../src/config/site.js';
import {
	PROJECT_LAYOUT,
	getProjectDeckReserve,
	getProjectImageSizes,
	getProjectMaximumCardOffset,
	getProjectMediaSlotWidth,
} from '../src/utils/project-layout.js';

type RuntimeIssues = {
	pageErrors: string[];
	consoleErrors: string[];
};

type FragmentReference = {
	error: string | null;
	fragment: string | null;
	href: string;
	label: string;
	targetDocument: string;
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

const inspectImages = (page: Page) => page.locator('img').evaluateAll(async (elements) => {
	const images = elements as HTMLImageElement[];

	await Promise.all(images.map(async (image) => {
		image.loading = 'eager';
		try {
			await image.decode();
		} catch {
			// The state below reports the failed URL with useful dimensions.
		}
	}));

	return {
		total: images.length,
		broken: images
			.filter((image) => !image.complete || image.naturalWidth === 0 || image.naturalHeight === 0)
			.map((image) => ({
				alt: image.alt,
				complete: image.complete,
				height: image.naturalHeight,
				src: image.currentSrc || image.src,
				width: image.naturalWidth,
			})),
	};
});

const inspectInternalFragments = (page: Page) => page.locator('a[href]').evaluateAll((elements) => {
	const links = elements as HTMLAnchorElement[];
	const currentUrl = new URL(window.location.href);
	const references: FragmentReference[] = [];

	for (const link of links) {
		const href = link.getAttribute('href');
		if (!href) continue;

		let targetUrl: URL;
		try {
			targetUrl = new URL(href, currentUrl);
		} catch {
			continue;
		}
		if (
			targetUrl.origin !== currentUrl.origin
			|| targetUrl.hash.length <= 1
		) continue;

		const label = link.textContent?.trim().replace(/\s+/g, ' ') || '(unlabelled link)';
		const targetDocument = `${targetUrl.pathname}${targetUrl.search}`;
		let fragment: string | null = null;
		try {
			fragment = decodeURIComponent(targetUrl.hash.slice(1));
		} catch {
			references.push({
				error: 'invalid fragment encoding',
				fragment,
				href,
				label,
				targetDocument,
			});
		}
		if (fragment !== null) {
			references.push({
				error: null,
				fragment,
				href,
				label,
				targetDocument,
			});
		}
	}

	const targets = [
		...Array.from(document.querySelectorAll<HTMLElement>('[id]'), (element) => element.id),
		...Array.from(
			document.querySelectorAll<HTMLAnchorElement>('a[name]'),
			(anchor) => anchor.getAttribute('name') ?? '',
		),
	].filter(Boolean);

	return {
		document: `${currentUrl.pathname}${currentUrl.search}`,
		references,
		targets: [...new Set(targets)],
	};
});

const inspectHorizontalOverflow = (page: Page) => page.evaluate(() => {
	const root = document.documentElement;
	const contentWidth = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0);

	return {
		contentWidth,
		layoutWidth: root.clientWidth,
		overflow: Math.max(0, contentWidth - root.clientWidth),
	};
});

const pageHealthViewports = [
	{ label: 'mobile', width: 390, height: 844 },
	{ label: 'desktop', width: 1_440, height: 900 },
] as const;

const pageHealthThemes = ['dark', 'light'] as const;

const pageHealthRoutes = ['/', '/404.html'] as const;

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
	await expect(page.getByRole('heading', { name: 'You’ve reached a dead end.' })).toBeVisible();
	await expect(page.locator('[data-page-loader]')).toHaveCount(0);
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
	expect(cspViolations).toEqual([]);
});

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
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(menu).toHaveAttribute('data-open', 'true');

		await page.locator('#home').tap({ position: { x: 20, y: 300 } });
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(menu).toHaveAttribute('data-open', 'false');

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
	expect(await page.evaluate(() => localStorage.getItem('portfolio-theme'))).toBe('light');

	await page.reload();
	await expect(page.locator('[data-page-loader]')).toHaveCount(0);
	await expect(root).toHaveAttribute('data-theme', 'light');
	await expect(root).toHaveAttribute('data-theme-preference', 'user');
});

test.describe('page health', () => {
	for (const viewport of pageHealthViewports) {
		for (const theme of pageHealthThemes) {
			test(`validates ${viewport.label} layout and assets in the ${theme} theme`, async ({ page }) => {
				await page.setViewportSize({ width: viewport.width, height: viewport.height });
				await page.addInitScript((selectedTheme) => {
					localStorage.setItem('portfolio-theme', selectedTheme);
				}, theme);

				const brokenImages: Array<{
					alt: string;
					complete: boolean;
					height: number;
					path: string;
					src: string;
					width: number;
				}> = [];
				const documentTargets = new Map<string, Set<string>>();
				const fragmentReferences: FragmentReference[] = [];
				const overflowFailures: Array<{
					contentWidth: number;
					layoutWidth: number;
					overflow: number;
					path: string;
				}> = [];
				let totalImages = 0;

				for (const path of pageHealthRoutes) {
					await openPage(page, path);
					await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

					const imageHealth = await inspectImages(page);
					totalImages += imageHealth.total;
					brokenImages.push(...imageHealth.broken.map((image) => ({ path, ...image })));

					const fragmentHealth = await inspectInternalFragments(page);
					documentTargets.set(fragmentHealth.document, new Set(fragmentHealth.targets));
					fragmentReferences.push(...fragmentHealth.references);

					const horizontalOverflow = await inspectHorizontalOverflow(page);
					if (horizontalOverflow.overflow > 1) {
						overflowFailures.push({ path, ...horizontalOverflow });
					}
				}

				expect(totalImages, 'The portfolio health check did not find any images.').toBeGreaterThan(0);
				expect(
					brokenImages,
					`Broken images at ${viewport.width}x${viewport.height} in the ${theme} theme.`,
				).toEqual([]);

				expect(
					fragmentReferences.length,
					'The portfolio health check did not find any internal fragment links.',
				).toBeGreaterThan(0);
				const missingFragments = fragmentReferences.flatMap((reference) => {
					if (reference.error) {
						return [`${reference.href} from "${reference.label}": ${reference.error}`];
					}
					const targets = documentTargets.get(reference.targetDocument);
					if (!targets) {
						return [`${reference.href} from "${reference.label}" targets an unaudited document`];
					}
					return reference.fragment && targets.has(reference.fragment)
						? []
						: [`${reference.href} from "${reference.label}"`];
				});
				expect(
					[...new Set(missingFragments)],
					'Internal links reference missing fragment targets.',
				).toEqual([]);

				expect(
					overflowFailures,
					`Horizontal document overflow at ${viewport.width}x${viewport.height} in the ${theme} theme.`,
				).toEqual([]);
			});
		}
	}
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

test('tilts the certification badge toward the pointer and resets it', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.setViewportSize({ width: 1440, height: 1000 });
	await openPortfolio(page);

	const tiltArea = page.locator('[data-cert-badge-tilt]');
	const tiltTarget = page.locator('[data-cert-badge-tilt-target]');
	await tiltArea.scrollIntoViewIfNeeded();
	const bounds = await tiltArea.boundingBox();
	expect(bounds).not.toBeNull();
	if (!bounds) return;

	const tiltMagnitude = () => tiltTarget.evaluate((element) => (
		Math.abs(Number.parseFloat(element.style.getPropertyValue('--cert-tilt-x')) || 0)
		+ Math.abs(Number.parseFloat(element.style.getPropertyValue('--cert-tilt-y')) || 0)
	));

	await page.mouse.move(
		bounds.x + bounds.width * 0.75,
		bounds.y + bounds.height * 0.25,
	);
	await expect.poll(tiltMagnitude).toBeGreaterThan(6);
	await expect.poll(() => tiltTarget.evaluate(
		(element) => getComputedStyle(element).transform,
	)).toMatch(/^matrix3d\(/);

	await page.mouse.move(bounds.x - 20, bounds.y - 20);
	await expect.poll(tiltMagnitude).toBe(0);

	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.mouse.move(
		bounds.x + bounds.width * 0.75,
		bounds.y + bounds.height * 0.25,
	);
	await expect.poll(tiltMagnitude).toBe(0);
	await expect(tiltTarget).toHaveCSS('transform', 'none');
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

test('keeps deck spacing and responsive image sizes aligned with project count', async ({ page }) => {
	await openPortfolio(page);

	const deck = page.locator('[data-project-deck]');
	const slides = deck.locator('[data-project-slide]');
	const projectCount = await slides.count();
	const deckReserve = getProjectDeckReserve(projectCount);
	expect(
		getProjectMaximumCardOffset(projectCount),
		`The ${projectCount}-project card fan exceeds half of its ${deckReserve}px reserve; revalidate the reserve before changing the project count.`,
	).toBeLessThanOrEqual(deckReserve / 2);
	await expect(deck).toHaveAttribute('data-project-count', String(projectCount));
	await expect(deck).toHaveAttribute('data-deck-reserve', String(deckReserve));
	expect(await deck.evaluate(
		(element) => getComputedStyle(element).getPropertyValue('--deck-reserve').trim(),
	)).toBe(`${deckReserve}px`);

	const imageMetadata = await page.locator('.project-card__image').evaluateAll((images) => (
		images.map((image) => ({
			width: Number(image.getAttribute('width')),
			height: Number(image.getAttribute('height')),
			sizes: image.getAttribute('sizes'),
		}))
	));
	imageMetadata.forEach(({ width, height, sizes }) => {
		expect(sizes).toBe(getProjectImageSizes({ width, height }, projectCount));
	});
	const moveToDeckEnd = async (controlSelector: string) => deck.evaluate(
		(element, selector) => {
			const control = element.querySelector<HTMLButtonElement>(selector);
			let remainingMoves = element.querySelectorAll('[data-project-slide]').length;
			while (control && !control.disabled && remainingMoves > 0) {
				control.click();
				remainingMoves -= 1;
			}
		},
		controlSelector,
	);
	const getCardFanBounds = async () => slides.evaluateAll((elements) => {
		const bounds = elements.map((element) => element.getBoundingClientRect());
		return {
			left: Math.min(...bounds.map((rect) => rect.left)),
			right: Math.max(...bounds.map((rect) => rect.right)),
			viewportWidth: document.documentElement.clientWidth,
		};
	});

	for (const viewport of [
		{ width: 320, height: 844 },
		{ width: 767, height: 900 },
		{ width: 768, height: 900 },
		{ width: 1_199, height: 800 },
		{ width: 1_200, height: 800 },
		{ width: 1_215, height: 800 },
		{ width: 1_216, height: 800 },
		{ width: 1_440, height: 800 },
	]) {
		await page.setViewportSize(viewport);
		await moveToDeckEnd('[data-project-previous]');
		await expect(deck).toHaveAttribute('data-active-index', '0');
		const startFanBounds = await getCardFanBounds();
		expect(startFanBounds.left).toBeGreaterThanOrEqual(-1);
		expect(startFanBounds.right).toBeLessThanOrEqual(startFanBounds.viewportWidth + 1);

		await moveToDeckEnd('[data-project-next]');
		await expect(deck).toHaveAttribute('data-active-index', String(projectCount - 1));
		const endFanBounds = await getCardFanBounds();
		expect(endFanBounds.left).toBeGreaterThanOrEqual(-1);
		expect(endFanBounds.right).toBeLessThanOrEqual(endFanBounds.viewportWidth + 1);

		const deckBounds = await deck.boundingBox();
		const activeSlideBounds = await slides.nth(projectCount - 1).boundingBox();
		const imageBounds = await slides.nth(projectCount - 1)
			.locator('.project-card__image')
			.first()
			.boundingBox();
		expect(deckBounds).not.toBeNull();
		expect(activeSlideBounds).not.toBeNull();
		expect(imageBounds).not.toBeNull();
		if (!deckBounds || !activeSlideBounds || !imageBounds) continue;

		expect(activeSlideBounds.width).toBeCloseTo(deckBounds.width - deckReserve, 0);

		const isDesktop = viewport.width >= PROJECT_LAYOUT.desktopBreakpoint;
		const expectedMediaWidth = getProjectMediaSlotWidth(
			deckBounds.width,
			projectCount,
			isDesktop,
		);
		expect(imageBounds.width).toBeCloseTo(expectedMediaWidth, 0);

		const expectedGutter = viewport.width >= PROJECT_LAYOUT.tabletBreakpoint
			? PROJECT_LAYOUT.tabletPageGutter
			: PROJECT_LAYOUT.mobilePageGutter;
		expect(await page.locator('.projects').evaluate((element) => (
			Number.parseFloat(getComputedStyle(element).paddingInlineStart)
		))).toBe(expectedGutter);
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

test('defers gallery scroll hints until their project card is active', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.setViewportSize({ width: 390, height: 844 });
	await openPortfolio(page);

	const deck = page.locator('[data-project-deck]');
	const slides = deck.locator('[data-project-slide]');
	const firstGallery = slides.nth(0).locator('[data-project-gallery]');
	const laterGallery = slides.nth(1).locator('[data-project-gallery]');

	await page.locator('[data-project-gallery]').evaluateAll((elements) => {
		elements.forEach((element) => {
			const gallery = element as HTMLElement;
			gallery.dataset.testGalleryHintStarts = '0';
			gallery.dataset.testGalleryHintState = 'idle';

			new MutationObserver(() => {
				if (gallery.dataset.galleryHinting === 'true') {
					gallery.dataset.testGalleryHintStarts = String(
						Number(gallery.dataset.testGalleryHintStarts ?? 0) + 1,
					);
					gallery.dataset.testGalleryHintState = 'running';
					return;
				}

				if (Number(gallery.dataset.testGalleryHintStarts ?? 0) > 0) {
					gallery.dataset.testGalleryHintState = 'ended';
				}
			}).observe(gallery, {
				attributes: true,
				attributeFilter: ['data-gallery-hinting'],
			});
		});
	});

	await firstGallery.scrollIntoViewIfNeeded();
	await expect(firstGallery).toHaveAttribute('data-test-gallery-hint-state', 'ended');
	await expect(slides.nth(1)).toHaveAttribute('data-active', 'false');
	await expect(laterGallery).toHaveAttribute('data-test-gallery-hint-starts', '0');

	await deck.locator('[data-project-next]').click();
	await expect(deck).toHaveAttribute('data-active-index', '1');
	await expect(slides.nth(1)).toHaveAttribute('data-active', 'true');
	await laterGallery.scrollIntoViewIfNeeded();
	await expect(laterGallery).toHaveAttribute('data-test-gallery-hint-state', 'ended');
	await expect(laterGallery).toHaveAttribute('data-test-gallery-hint-starts', '1');
});

test('shows a card focus ring when the gallery scroll region takes keyboard focus', async ({ page }) => {
	await openPortfolio(page);

	const activeCard = page.locator('[data-project-slide][data-active="true"] .project-card');
	await expect(activeCard).toHaveCSS('outline-style', 'none');

	const focusedGallery = page.locator('[data-project-gallery]:focus');

	for (let press = 0; press < 24 && await focusedGallery.count() === 0; press += 1) {
		await page.keyboard.press('Tab');
	}

	await expect(focusedGallery).toHaveCount(1);
	await expect(activeCard).toHaveCSS('outline-style', 'solid');
	await expect(activeCard).toHaveCSS('outline-width', '2px');
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

test('renders an accessible custom 404 with working recovery links', async ({ page }) => {
	await page.emulateMedia({ reducedMotion: 'no-preference' });
	await page.setViewportSize({ width: 390, height: 844 });
	const response = await page.goto('/404.html');

	expect(response?.status()).toBe(200);
	expect(await page.locator('[data-page-loader]').count()).toBe(0);
	expect(await page.locator('html').getAttribute('data-page-loading')).toBeNull();
	await expect(page).toHaveTitle('Page not found | Adam Salicki');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('You’ve reached a dead end.');
	await expect(page.locator('.not-found__panel')).toHaveCount(0);
	await expect(page.getByText('Route not found')).toHaveCount(0);
	await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, follow');
	await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
		'href',
		'https://adamsalicki.pages.dev/404',
	);
	await expect(page.getByRole('contentinfo')).toHaveCount(0);
	await expect(page.getByRole('link', { name: 'Back to portfolio' })).toHaveAttribute('href', '/');

	for (const viewport of [
		{ width: 320, height: 700 },
		{ width: 390, height: 844 },
		{ width: 1_440, height: 900 },
	]) {
		await page.setViewportSize(viewport);
		expect(
			await page.locator('.not-found__content').evaluate((element) => {
				const contentBounds = element.getBoundingClientRect();
				const sectionBounds = element.closest('.not-found')?.getBoundingClientRect();
				if (!sectionBounds) return Number.POSITIVE_INFINITY;
				return Math.abs(
					contentBounds.x + contentBounds.width / 2
					- (sectionBounds.x + sectionBounds.width / 2)
				);
			}),
			`404 content is not horizontally centered at ${viewport.width}px`,
		).toBeLessThanOrEqual(1);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth),
			`404 page overflows horizontally at ${viewport.width}px`,
		).toBeLessThanOrEqual(viewport.width);
		expect(
			await page.locator('.not-found').evaluate((element) => (
				Math.round(element.getBoundingClientRect().bottom)
			)),
			`404 page does not fill the viewport at ${viewport.width}px`,
		).toBeGreaterThanOrEqual(viewport.height);
	}

	expect(await page.locator('.not-found__code').evaluate((element) => (
		Number.parseFloat(getComputedStyle(element).fontSize)
	))).toBeGreaterThanOrEqual(320);
	expect(await page.locator('.not-found__content').evaluate((element) => {
		const codeBounds = element.querySelector('.not-found__code')?.getBoundingClientRect();
		const headingBounds = element.querySelector('h1')?.getBoundingClientRect();
		if (!codeBounds || !headingBounds) return Number.NEGATIVE_INFINITY;
		return headingBounds.top - codeBounds.bottom;
	})).toBeGreaterThanOrEqual(40);

	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'Toggle navigation' }).click();
	await expect(page.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/#about');
	await expect(page.getByRole('link', { name: 'Projects' })).toHaveAttribute('href', '/#projects');
	await expect(page.getByRole('link', { name: 'Contact' })).toHaveAttribute('href', '/#contact');
	await page.getByRole('button', { name: 'Toggle navigation' }).click();

	const magneticWrapper = page.locator('.not-found__home-magnetic');
	const backToPortfolio = page.getByRole('link', { name: 'Back to portfolio' });
	const magneticBounds = await magneticWrapper.boundingBox();
	expect(magneticBounds).not.toBeNull();
	if (magneticBounds) {
		await page.mouse.move(
			magneticBounds.x + magneticBounds.width - 2,
			magneticBounds.y + magneticBounds.height / 2,
		);
		await expect.poll(() => backToPortfolio.evaluate((element) => (
			Number.parseFloat(element.style.transform.match(/translate3d\(([-\d.]+)px/)?.[1] ?? '0')
		))).toBeGreaterThan(0);

		await page.mouse.move(magneticBounds.x - 20, magneticBounds.y - 20);
		await expect.poll(() => backToPortfolio.evaluate((element) => {
			const transform = element.style.transform.match(
				/translate3d\(([-\d.]+)px,\s*([-\d.]+)px/,
			);
			if (!transform) return 0;
			return Math.hypot(
				Number.parseFloat(transform[1]),
				Number.parseFloat(transform[2]),
			);
		})).toBeLessThanOrEqual(0.1);
	}

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
		.analyze();
	expect(results.violations).toEqual([]);
});

test('has no automatically detectable WCAG A or AA violations', async ({ page }) => {
	await openPortfolio(page);

	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
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
