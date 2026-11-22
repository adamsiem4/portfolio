import { glyphPresets } from './glyphs.js';
import { scenes } from './scenes/index.js';

// The core owns the canvas, grid, loop, input, cursor wake, colours, and the
// quiet zones that dim glyphs behind `[data-background-quiet]` text. A scene only
// writes per-cell intensity and heat; a glyph preset turns those into characters
// and, optionally, shaded tiles behind them. Glyphs are pre-rendered once per
// colour into an atlas and copied with drawImage, which is far cheaper than
// rasterising every cell with fillText each frame.

const PROFILES = {
	desktop: { cell: 14, maxDpr: 2, fps: 60, compact: false },
	mobile: { cell: 12, maxDpr: 1.5, fps: 30, compact: true },
};
// Without a pointer or wake on screen the motion is slow enough for 30 fps; full
// rate only pays off while the user is interacting.
const IDLE_FPS = 30;
// Backing-store budget: 1440x900 at 2x (~5.2 M px) measured smooth, 2560x1440 at 2x
// (~14.7 M px) dropped to ~37 fps. Larger screens lower their DPR to stay within it.
const MAX_BACKING_PIXELS = 6_000_000;
const POINTER_RADIUS = 120;
const INTERACTIVE = 'a, button, input, select, textarea, label, summary, [role="button"], [data-magnetic]';
const MIN_INTENSITY = 0.04;
const MIN_ALPHA = 0.06;
const MAX_ALPHA = 0.24;
const HEAT_ALPHA = 0.5;
const TILE_MIN_ALPHA = 0.03;
const TILE_MAX_ALPHA = 0.16;
const TILE_HEAT_ALPHA = 0.22;
const TILE_GAP = 1;
// Dense glyphs are knocked out of their tile in the background colour.
const CUTOUT_ALPHA = 0.85;
const HEAT_SCRAMBLE = 8;
const ACCENT_HEAT = 0.35;
// One in 32 dense cells is accented: roughly 3%.
const ACCENT_EVERY = 32;
const ALPHA_LEVELS = 32;
const SETTLE_STEPS = 90;
// Cursor wake, in cells and seconds.
const WAKE_RADIUS = 2.2;
const WAKE_STEP = 0.5;
const WAKE_HALF_LIFE = 0.35;
const WAKE_INTENSITY = 0.75;
// Glyphs behind text are scaled by QUIET_ALPHA and capped at QUIET_MAX_ALPHA, so
// even a heated light-theme glyph (strength 2) stays faint enough to read over.
const QUIET_ALPHA = 0.35;
const QUIET_MAX_ALPHA = 0.2;
// Atlas slots overhang the cell so glyphs wider or taller than it are not clipped.
const ATLAS_PADDING = 2;
const FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const TEXT = 0;
const ACCENT = 1;
const BACKGROUND = 2;

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;

const bucketIndex = (color, alpha) => color * ALPHA_LEVELS + Math.round(Math.min(1, alpha) * (ALPHA_LEVELS - 1));
const hush = (alpha) => Math.min(QUIET_MAX_ALPHA, alpha * QUIET_ALPHA);

export const initCyberBackground = (canvas) => {
	if (canvas.dataset.cyberReady === 'true') return;

	const createScene = scenes[canvas.dataset.scene];
	const preset = glyphPresets[canvas.dataset.glyphs];
	if (!createScene) throw new Error(`Unknown background scene "${canvas.dataset.scene}"`);
	if (!preset) throw new Error(`Unknown background glyph preset "${canvas.dataset.glyphs}"`);

	const context = canvas.getContext('2d');
	if (!context) return;
	canvas.dataset.cyberReady = 'true';

	const scene = createScene();
	// Each distinct glyph gets one atlas column; ramp and core map to column indices.
	const glyphs = [...new Set([...preset.ramp, ...preset.core])];
	const ramp = [...preset.ramp].map((glyph) => glyphs.indexOf(glyph));
	const core = [...preset.core].map((glyph) => glyphs.indexOf(glyph));
	// Ramp glyphs are indexed by intensity, core glyphs by each cell's random seed.
	const glyphAt = (value, seed) => {
		if (value >= preset.coreFrom) return core[seed % core.length];
		const position = (value - MIN_INTENSITY) / (preset.coreFrom - MIN_INTENSITY);
		return ramp[Math.min(ramp.length - 1, Math.floor(position * ramp.length))];
	};
	const tileBuckets = Array.from({ length: 2 * ALPHA_LEVELS }, () => []);
	const glyphBuckets = Array.from({ length: 3 * ALPHA_LEVELS }, () => []);
	const colors = ['', '', ''];
	// Static list: the page has no client router, so quiet blocks never change.
	const quietNodes = document.querySelectorAll('[data-background-quiet]');
	const atlas = document.createElement('canvas');
	const atlasContext = atlas.getContext('2d');

	let profile = PROFILES.desktop;
	let width = 0;
	let height = 0;
	let cells = null;
	let seeds = new Uint8Array(0);
	let wake = new Float32Array(0);
	let wakeActive = false;
	let strength = 1;
	let dpr = 1;
	let quiet = new Uint8Array(0);
	// Atlas slot edge in device pixels, and the same edge in CSS pixels.
	let slot = 0;
	let slotSize = 0;
	let frame = 0;
	let scrollFrame = 0;
	let lastFrame = 0;
	const pointer = { x: 0, y: 0, active: false };

	const readColors = () => {
		const styles = getComputedStyle(root);
		colors[TEXT] = styles.getPropertyValue('--color-text').trim();
		colors[ACCENT] = styles.getPropertyValue('--color-accent-text').trim();
		colors[BACKGROUND] = styles.getPropertyValue('--color-background').trim();
		strength = Number.parseFloat(styles.getPropertyValue('--background-glyph-strength')) || 1;
	};

	// Rasterises every glyph once per colour at the current cell size and DPR. The
	// slot is a whole number of device pixels so drawImage copies it 1:1.
	const buildAtlas = () => {
		slot = Math.ceil((profile.cell + ATLAS_PADDING * 2) * dpr);
		slotSize = slot / dpr;
		// Resizing also clears the atlas and resets its context state.
		atlas.width = slot * glyphs.length;
		atlas.height = slot * colors.length;
		atlasContext.setTransform(dpr, 0, 0, dpr, 0, 0);
		atlasContext.font = `${Math.round(profile.cell * 0.72)}px ${FONT_FAMILY}`;
		atlasContext.textAlign = 'center';
		atlasContext.textBaseline = 'middle';
		colors.forEach((color, row) => {
			atlasContext.fillStyle = color;
			glyphs.forEach((glyph, column) => {
				atlasContext.fillText(glyph, (column + 0.5) * slotSize, (row + 0.5) * slotSize);
			});
		});
	};

	const resize = (boundsWidth, boundsHeight) => {
		if (boundsWidth < 1 || boundsHeight < 1) return false;

		profile = finePointer.matches ? PROFILES.desktop : PROFILES.mobile;
		dpr = Math.min(
			window.devicePixelRatio || 1,
			profile.maxDpr,
			Math.sqrt(MAX_BACKING_PIXELS / (boundsWidth * boundsHeight)),
		);
		width = boundsWidth;
		height = boundsHeight;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		canvas.style.setProperty('--cyber-cell', `${profile.cell}px`);
		canvas.dataset.active = 'true';

		const cols = Math.ceil(width / profile.cell);
		const rows = Math.ceil(height / profile.cell);
		cells = {
			cols,
			rows,
			intensity: new Float32Array(cols * rows),
			heat: new Float32Array(cols * rows),
		};
		seeds = Uint8Array.from({ length: cols * rows }, () => Math.random() * 256);
		wake = new Float32Array(cols * rows);
		wakeActive = false;
		quiet = new Uint8Array(cols * rows);

		// Resizing the backing store resets context state.
		context.setTransform(dpr, 0, 0, dpr, 0, 0);
		buildAtlas();

		scene.resize(cols, rows, { compact: profile.compact });
		return true;
	};

	// Stamps a soft disc into the wake along the segment, WAKE_STEP cells apart, so
	// fast cursor moves still leave a continuous trail.
	const stampWake = (fromX, fromY, toX, toY) => {
		const { cols, rows } = cells;
		const startX = fromX / profile.cell;
		const startY = fromY / profile.cell;
		const deltaX = toX / profile.cell - startX;
		const deltaY = toY / profile.cell - startY;
		const steps = Math.max(1, Math.ceil(Math.hypot(deltaX, deltaY) / WAKE_STEP));

		for (let step = 0; step <= steps; step += 1) {
			const x = startX + (deltaX * step) / steps;
			const y = startY + (deltaY * step) / steps;
			const top = Math.max(0, Math.floor(y - WAKE_RADIUS));
			const bottom = Math.min(rows - 1, Math.ceil(y + WAKE_RADIUS));
			const left = Math.max(0, Math.floor(x - WAKE_RADIUS));
			const right = Math.min(cols - 1, Math.ceil(x + WAKE_RADIUS));
			for (let row = top; row <= bottom; row += 1) {
				for (let col = left; col <= right; col += 1) {
					const strength = 1 - Math.hypot(col + 0.5 - x, row + 0.5 - y) / WAKE_RADIUS;
					const index = row * cols + col;
					if (strength > wake[index]) wake[index] = strength;
				}
			}
		}
		wakeActive = true;
	};

	const decayWake = (dt) => {
		if (!wakeActive) return;
		const decay = 0.5 ** (dt / WAKE_HALF_LIFE);
		let strongest = 0;
		for (let index = 0; index < wake.length; index += 1) {
			if (wake[index] === 0) continue;
			wake[index] = wake[index] * decay < 0.02 ? 0 : wake[index] * decay;
			strongest = Math.max(strongest, wake[index]);
		}
		wakeActive = strongest > 0;
	};

	// Marks every cell under a quiet block, padded by one cell. Rects are read
	// fresh each frame because the blocks scroll under the fixed canvas; nothing
	// here writes to layout, so the reads cannot thrash.
	const markQuiet = () => {
		quiet.fill(0);
		const { cols, rows } = cells;
		const cell = profile.cell;
		for (const node of quietNodes) {
			const rect = node.getBoundingClientRect();
			if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= height || rect.left >= width) continue;
			const left = Math.max(0, Math.floor(rect.left / cell) - 1);
			const right = Math.min(cols - 1, Math.ceil(rect.right / cell));
			const top = Math.max(0, Math.floor(rect.top / cell) - 1);
			const bottom = Math.min(rows - 1, Math.ceil(rect.bottom / cell));
			for (let row = top; row <= bottom; row += 1) quiet.fill(1, row * cols + left, row * cols + right + 1);
		}
	};

	const drawBuckets = (buckets, cols, draw) => {
		buckets.forEach((bucket, index) => {
			if (bucket.length === 0) return;
			const color = Math.floor(index / ALPHA_LEVELS);
			context.fillStyle = colors[color];
			context.globalAlpha = (index % ALPHA_LEVELS) / (ALPHA_LEVELS - 1);
			bucket.forEach((cellIndex) => {
				const col = cellIndex % cols;
				draw(cellIndex, col * profile.cell, ((cellIndex - col) / cols) * profile.cell, color);
			});
		});
	};

	const render = (dt) => {
		if (!cells) return;
		const { cols, intensity, heat } = cells;
		intensity.fill(0);
		heat.fill(0);
		scene.fill(cells);
		if (quietNodes.length > 0) markQuiet();

		tileBuckets.forEach((bucket) => {
			bucket.length = 0;
		});
		glyphBuckets.forEach((bucket) => {
			bucket.length = 0;
		});
		const scramble = preset.scramble * dt;
		for (let index = 0; index < intensity.length; index += 1) {
			if (wakeActive && wake[index] > 0) {
				intensity[index] = Math.max(intensity[index], wake[index] * WAKE_INTENSITY);
				heat[index] = Math.max(heat[index], wake[index]);
			}

			const value = intensity[index];
			if (value < MIN_INTENSITY) continue;

			const warmth = heat[index];
			if (Math.random() < scramble + warmth * HEAT_SCRAMBLE * dt) seeds[index] = Math.random() * 256;

			const quieted = quiet[index] === 1;
			// Random accents would flicker behind text; only the wake may accent there.
			const accent = warmth > ACCENT_HEAT
				|| (!quieted && value >= preset.coreFrom && seeds[index] % ACCENT_EVERY === 0);
			let glyphAlpha = (MIN_ALPHA + (MAX_ALPHA - MIN_ALPHA) * value) * strength + HEAT_ALPHA * warmth;
			if (quieted) glyphAlpha = hush(glyphAlpha);

			if (!preset.tiles) {
				glyphBuckets[bucketIndex(accent ? ACCENT : TEXT, glyphAlpha)].push(index);
				continue;
			}

			let tileAlpha = (TILE_MIN_ALPHA + (TILE_MAX_ALPHA - TILE_MIN_ALPHA) * value) * strength + TILE_HEAT_ALPHA * warmth;
			if (quieted) tileAlpha = hush(tileAlpha);
			tileBuckets[bucketIndex(accent ? ACCENT : TEXT, tileAlpha)].push(index);
			glyphBuckets[value >= preset.coreFrom
				? bucketIndex(BACKGROUND, CUTOUT_ALPHA)
				: bucketIndex(accent ? ACCENT : TEXT, glyphAlpha)].push(index);
		}

		// Batch by colour and alpha so the context state changes at most once per bucket.
		context.clearRect(0, 0, width, height);
		const tileSize = profile.cell - TILE_GAP * 2;
		drawBuckets(tileBuckets, cols, (index, x, y) => {
			context.fillRect(x + TILE_GAP, y + TILE_GAP, tileSize, tileSize);
		});
		// The slot overhangs the cell equally on every side, keeping glyphs centred.
		const offset = (profile.cell - slotSize) / 2;
		drawBuckets(glyphBuckets, cols, (index, x, y, color) => {
			context.drawImage(
				atlas,
				glyphAt(intensity[index], seeds[index]) * slot,
				color * slot,
				slot,
				slot,
				x + offset,
				y + offset,
				slotSize,
				slotSize,
			);
		});
		context.globalAlpha = 1;
	};

	const tick = (now) => {
		frame = requestAnimationFrame(tick);
		const elapsed = now - lastFrame;
		// Every pointer move stamps the wake, so an active wake means recent motion; a
		// cursor resting over the page stays on the idle rate.
		const fps = wakeActive ? profile.fps : Math.min(profile.fps, IDLE_FPS);
		// The small tolerance keeps a 30 fps cap from dropping to 20 fps on 60 Hz jitter.
		if (elapsed < 1000 / fps - 2) return;
		lastFrame = now;
		const dt = Math.min(elapsed / 1000, 0.1);
		scene.step(dt, pointer.active
			? {
				x: pointer.x / profile.cell,
				y: pointer.y / profile.cell,
				radius: POINTER_RADIUS / profile.cell,
			}
			: null);
		decayWake(dt);
		render(dt);
	};

	const stop = () => {
		cancelAnimationFrame(frame);
		frame = 0;
	};

	const syncMotion = () => {
		stop();
		// The first measurement calls this again once there is a grid.
		if (!cells) return;
		if (reducedMotion.matches) {
			// One settled frame instead of a loop; a still frame carries no wake.
			wake.fill(0);
			wakeActive = false;
			for (let index = 0; index < SETTLE_STEPS; index += 1) scene.step(1 / 30, null);
			render(0);
			return;
		}

		if (document.visibilityState !== 'visible') return;
		lastFrame = performance.now();
		frame = requestAnimationFrame(tick);
	};

	// The observer fires once on observe, so it also takes the first measurement;
	// measuring at init as well would size and draw everything twice.
	new ResizeObserver(([entry]) => {
		const first = !cells;
		if (!resize(entry.contentRect.width, entry.contentRect.height)) return;
		// The first measurement starts the loop or draws the settled still frame.
		if (first) syncMotion();
		// A resized backing store is blank until the next draw; repaint now unless
		// the still frame already did.
		if (!first || frame !== 0) render(0);
	}).observe(canvas);
	// The canvas keeps its size, so the last measurement is reused for the new profile.
	finePointer.addEventListener('change', () => {
		if (cells && resize(width, height)) render(0);
	});
	reducedMotion.addEventListener('change', syncMotion);
	document.addEventListener('visibilitychange', syncMotion);

	// The still frame is not redrawn by a loop, so quiet zones would stay where
	// the text was; one coalesced repaint per frame keeps them under it.
	window.addEventListener('scroll', () => {
		if (frame !== 0 || scrollFrame !== 0 || !cells || quietNodes.length === 0) return;
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = 0;
			if (frame === 0) render(0);
		});
	}, { passive: true });

	// Fired synchronously inside the theme View Transition update, so the new
	// snapshot already carries the recoloured glyphs.
	document.addEventListener('site-theme-change', () => {
		readColors();
		if (!cells) return;
		buildAtlas();
		render(0);
	});

	const movePointer = (x, y) => {
		if (frame !== 0 && cells) {
			// A fresh entry or touch starts a new trail instead of joining the last point.
			if (pointer.active) stampWake(pointer.x, pointer.y, x, y);
			else stampWake(x, y, x, y);
		}
		pointer.x = x;
		pointer.y = y;
		pointer.active = true;
	};
	const releasePointer = () => {
		pointer.active = false;
	};

	window.addEventListener('pointermove', (event) => {
		// Touch pointer events are cancelled once the browser starts scrolling; the
		// passive touch listeners below keep following the finger instead.
		if (event.pointerType !== 'touch') movePointer(event.clientX, event.clientY);
	}, { passive: true });
	root.addEventListener('pointerleave', releasePointer);
	window.addEventListener('blur', releasePointer);

	const followTouch = (event) => {
		const touch = event.touches[0];
		if (touch) movePointer(touch.clientX, touch.clientY);
	};
	window.addEventListener('touchstart', followTouch, { passive: true });
	window.addEventListener('touchmove', followTouch, { passive: true });
	window.addEventListener('touchend', (event) => {
		if (event.touches.length === 0) releasePointer();
	}, { passive: true });
	window.addEventListener('touchcancel', releasePointer, { passive: true });

	window.addEventListener('pointerdown', (event) => {
		if (frame === 0 || !finePointer.matches || event.pointerType === 'touch' || event.button !== 0) return;
		if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return;
		scene.splash(event.clientX / profile.cell, event.clientY / profile.cell);
	}, { passive: true });

	readColors();
};
