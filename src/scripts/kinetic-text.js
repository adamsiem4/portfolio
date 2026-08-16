// Effect controls: tiles sets grid density; offset is the base CSS-pixel displacement;
// speed/spread control wave phase; chroma/shade control color and tile contrast.
const DEFAULT_PARAMS = {
	text: 'Adam Salicki',
	paper: '#090b0c',
	ink: '#ffffff',
	accent: '#08665f',
	tiles: 42,
	offset: 12,
	speed: 0.022,
	spread: 0.02,
	chroma: 0.18,
	shade: 0.28,
};

const MOBILE_BREAKPOINT = 768;
const MOBILE_MAX_DPR = 1.25;
const MOBILE_MAX_TILES = 34;
const TARGET_FPS = 60;
const FRAME_DURATION = 1000 / TARGET_FPS;

function parseHex(value, fallback) {
	let hex = value.trim().replace('#', '');
	if (hex.length === 3) {
		hex = hex.split('').map((character) => character + character).join('');
	}

	if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback;

	return [
		Number.parseInt(hex.slice(0, 2), 16),
		Number.parseInt(hex.slice(2, 4), 16),
		Number.parseInt(hex.slice(4, 6), 16),
	];
}

function rgba([red, green, blue]) {
	return `rgba(${red}, ${green}, ${blue}, 1)`;
}

function cssToken(name, fallback) {
	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	return value || fallback;
}

export class KineticText {
	constructor(stage, params = {}) {
		this.stage = stage;
		this.params = { ...DEFAULT_PARAMS, ...params };
		this.frame = 0;
		this.raf = 0;
		this.resizeFrame = 0;
		this.lastFrameTime = 0;
		this.running = false;
		this.inView = true;
		this.pageHidden = document.hidden;
		this.reducedQuality = false;
		this.box = { x0: 0, y0: 0, x1: 0, y1: 0 };
		this.coarsePointer = window.matchMedia('(pointer: coarse)');

		this.canvas = document.createElement('canvas');
		this.canvas.setAttribute('aria-hidden', 'true');
		Object.assign(this.canvas.style, {
			position: 'absolute',
			inset: '0',
			width: '100%',
			height: '100%',
			display: 'block',
		});
		this.stage.appendChild(this.canvas);

		// The effect renders in stages: mask stores text alpha, warp displaces mask
		// tiles, tint colorizes that alpha, and canvas presents the final composite.
		this.mask = document.createElement('canvas');
		this.warp = document.createElement('canvas');
		this.tint = document.createElement('canvas');

		this.ctx = this.canvas.getContext('2d');
		this.maskContext = this.mask.getContext('2d');
		this.warpContext = this.warp.getContext('2d');
		this.tintContext = this.tint.getContext('2d');

		if (!this.ctx || !this.maskContext || !this.warpContext || !this.tintContext) {
			throw new Error('Canvas 2D rendering is not supported in this browser.');
		}

		this.tick = this.tick.bind(this);
		this.handleVisibility = this.handleVisibility.bind(this);
		this.handleMotionPreference = this.handleMotionPreference.bind(this);
		this.handleThemeChange = this.handleThemeChange.bind(this);

		this.applyColors();
		this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
		this.reducedMotion = this.motionPreference.matches;
		this.motionPreference.addEventListener?.('change', this.handleMotionPreference);

		this.resizeObserver = new ResizeObserver(() => {
			// ResizeObserver may fire several times during one layout. Coalesce those
			// notifications so buffers are rebuilt at most once per paint frame.
			if (this.resizeFrame) return;

			this.resizeFrame = window.requestAnimationFrame(() => {
				this.resizeFrame = 0;
				this.resize();
			});
		});
		this.resizeObserver.observe(this.stage);

		this.intersectionObserver = new IntersectionObserver(([entry]) => {
			this.inView = entry
				? entry.isIntersecting && entry.intersectionRatio >= 0.05
				: true;
			this.syncAnimation();
		}, { threshold: [0, 0.05] });
		this.intersectionObserver.observe(this.stage);

		document.addEventListener('visibilitychange', this.handleVisibility);
		document.addEventListener('site-theme-change', this.handleThemeChange);
		this.resize();
		this.syncAnimation();

		// Web fonts can change glyph metrics after the first mask was measured.
		document.fonts?.ready.then(() => {
			this.drawText();
			if (!this.running) this.renderStatic();
		});
	}

	applyColors() {
		this.paperColor = parseHex(this.params.paper, [9, 11, 12]);
		this.inkColor = parseHex(this.params.ink, [255, 255, 255]);
		this.accentColor = parseHex(this.params.accent, [8, 102, 95]);
		this.inverseAccentColor = this.accentColor.map((channel) => 255 - channel);
	}

	resize() {
		const bounds = this.stage.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;

		// Limit DPR and grid density on smaller/coarse-pointer devices. This reduces
		// per-frame pixel work while preserving text legibility and animation cadence.
		const reducedQuality = bounds.width < MOBILE_BREAKPOINT || this.coarsePointer.matches;
		const maximumDpr = reducedQuality ? MOBILE_MAX_DPR : 2;
		const dpr = Math.min(window.devicePixelRatio || 1, maximumDpr);
		const width = Math.round(bounds.width * dpr);
		const height = Math.round(bounds.height * dpr);

		if (
			width === this.width &&
			height === this.height &&
			reducedQuality === this.reducedQuality
		) return;

		this.reducedQuality = reducedQuality;
		this.dpr = dpr;
		this.width = width;
		this.height = height;

		for (const canvas of [this.canvas, this.mask, this.warp, this.tint]) {
			canvas.width = this.width;
			canvas.height = this.height;
		}

		this.drawText();
		this.renderStatic();
		this.stage.dataset.ready = 'true';
	}

	drawText() {
		const context = this.maskContext;
		const text = (this.params.text || DEFAULT_PARAMS.text).slice(0, 40);
		const singleCharacter = text.length === 1;
		const isMobile = this.width / this.dpr < MOBILE_BREAKPOINT;
		const maxWidth = this.width * (isMobile ? 0.82 : 0.9);
		let fontSize = Math.round(this.height * (singleCharacter ? 0.82 : 0.58));

		context.clearRect(0, 0, this.width, this.height);
		context.fillStyle = '#ffffff';
		context.textAlign = 'center';
		context.textBaseline = 'middle';

		const setFont = () => {
			context.font = `800 ${fontSize}px Raleway, system-ui, sans-serif`;
		};

		setFont();
		let metrics = context.measureText(text);
		if (metrics.width > maxWidth) {
			fontSize = Math.max(12, Math.floor(fontSize * (maxWidth / metrics.width)));
			setFont();
			metrics = context.measureText(text);
		}

		context.fillText(text, this.width / 2, this.height / 2);
		this.measureInkBounds(metrics.width, fontSize);
	}

	measureInkBounds(measuredWidth, fontSize) {
		const centerX = this.width / 2;
		const centerY = this.height / 2;
		const padding = Math.ceil((this.params.offset + 4) * this.dpr);
		const halfWidth = measuredWidth / 2;
		const halfHeight = fontSize * 0.65;

		this.box = {
			x0: Math.max(0, Math.floor(centerX - halfWidth - padding)),
			y0: Math.max(0, Math.floor(centerY - halfHeight - padding)),
			x1: Math.min(this.width, Math.ceil(centerX + halfWidth + padding)),
			y1: Math.min(this.height, Math.ceil(centerY + halfHeight + padding)),
		};
	}

	renderFrame() {
		if (!this.width || !this.height) return;

		const context = this.warpContext;
		const { tiles, offset, speed, spread, shade } = this.params;
		const isMobile = this.width / this.dpr < MOBILE_BREAKPOINT;
		const motionScale = isMobile ? 0.5 : 1;
		const activeSpread = spread * motionScale;
		const activeTiles = this.reducedQuality ? Math.min(tiles, MOBILE_MAX_TILES) : tiles;
		const tilesX = Math.max(2, Math.round(activeTiles));
		const tilesY = Math.max(2, Math.round(tilesX * (this.height / this.width)));
		const tileWidth = Math.floor(this.width / tilesX);
		const tileHeight = Math.floor(this.height / tilesY);
		const displacement = offset * motionScale * this.dpr;

		context.globalCompositeOperation = 'source-over';
		context.globalAlpha = 1;
		context.clearRect(0, 0, this.width, this.height);

		if (tileWidth > 0 && tileHeight > 0) {
			// Limit tile work to approximate glyph bounds, padded by displacement so
			// wave-shifted samples near the text edge are not clipped.
			const columnStart = Math.max(0, Math.floor(this.box.x0 / tileWidth) - 1);
			const columnEnd = Math.min(tilesX - 1, Math.ceil(this.box.x1 / tileWidth) + 1);
			const rowStart = Math.max(0, Math.floor(this.box.y0 / tileHeight) - 1);
			const rowEnd = Math.min(tilesY - 1, Math.ceil(this.box.y1 / tileHeight) + 1);
			const time = this.frame * speed;

			for (let row = rowStart; row <= rowEnd; row += 1) {
				for (let column = columnStart; column <= columnEnd; column += 1) {
					const phase = column * row;
					const firstWave = Math.sin(time + phase * activeSpread);
					const secondWave = Math.sin(time * 0.7 + (column + row) * activeSpread * 1.9 + 1.3);
					const movement = firstWave * 0.65 + secondWave * 0.45;
					const sourceOffsetX = Math.round(movement * displacement);
					const sourceOffsetY = Math.round(
						Math.sin(time * 0.9 + phase * activeSpread * 0.6) * displacement * 0.7,
					);

					const destinationX = column * tileWidth;
					const destinationY = row * tileHeight;
					const width = column === tilesX - 1 ? this.width - destinationX : tileWidth;
					const height = row === tilesY - 1 ? this.height - destinationY : tileHeight;
					const sourceX = destinationX + sourceOffsetX;
					const sourceY = destinationY + sourceOffsetY;

					if (
						width <= 0 ||
						height <= 0 ||
						sourceX + width <= 0 ||
						sourceY + height <= 0 ||
						sourceX >= this.width ||
						sourceY >= this.height
					) continue;

					context.globalAlpha = shade > 0
						? 1 - shade * 0.5 + Math.min(1, Math.abs(movement)) * shade * 0.5
						: 1;
					// Destination tiles stay fixed while their source rectangles sample a
					// wave-shifted part of the text mask, producing the distortion.
					context.drawImage(
						this.mask,
						sourceX,
						sourceY,
						width,
						height,
						destinationX,
						destinationY,
						width,
						height,
					);
				}
			}
		}

		context.globalAlpha = 1;
		this.compositeFrame();
	}

	compositeFrame() {
		const { chroma } = this.params;
		this.ctx.globalCompositeOperation = 'source-over';
		this.ctx.globalAlpha = 1;
		this.ctx.fillStyle = rgba(this.paperColor);
		this.ctx.fillRect(0, 0, this.width, this.height);

		if (this.reducedQuality) {
			// source-in uses the warped alpha as a stencil. Reduced quality performs
			// only this ink pass and skips the optional chromatic offset composites.
			this.warpContext.globalCompositeOperation = 'source-in';
			this.warpContext.fillStyle = rgba(this.inkColor);
			this.warpContext.fillRect(0, 0, this.width, this.height);
			this.warpContext.globalCompositeOperation = 'source-over';
			this.ctx.drawImage(this.warp, 0, 0);
			return;
		}

		if (chroma > 0) {
			const shift = Math.round(chroma * 5 * this.dpr) + 1;
			this.compositeTint(this.accentColor, shift, chroma * 0.7);
			this.compositeTint(this.inverseAccentColor, -shift, chroma * 0.45);
		}

		this.compositeTint(this.inkColor, 0, 1);
	}

	compositeTint(color, offsetX, alpha) {
		const context = this.tintContext;
		context.globalCompositeOperation = 'source-over';
		context.globalAlpha = 1;
		context.clearRect(0, 0, this.width, this.height);
		context.drawImage(this.warp, 0, 0);
		context.globalCompositeOperation = 'source-in';
		context.fillStyle = rgba(color);
		context.fillRect(0, 0, this.width, this.height);
		context.globalCompositeOperation = 'source-over';

		this.ctx.globalAlpha = alpha;
		this.ctx.drawImage(this.tint, offsetX, 0);
		this.ctx.globalAlpha = 1;
	}

	renderStatic() {
		this.frame = 0;
		this.renderFrame();
	}

	tick(timestamp) {
		if (!this.running) return;

		// Advance in 60-fps units, cap long suspension gaps, and carry the fractional
		// elapsed remainder so later samples stay aligned to the frame interval.
		const elapsed = timestamp - this.lastFrameTime;
		if (this.lastFrameTime === 0 || elapsed >= FRAME_DURATION) {
			const frameTime = this.lastFrameTime === 0
				? FRAME_DURATION
				: Math.min(elapsed, 100);

			this.frame += frameTime / FRAME_DURATION;
			this.lastFrameTime = this.lastFrameTime === 0
				? timestamp
				: timestamp - (elapsed % FRAME_DURATION);
			this.renderFrame();
		}

		this.raf = window.requestAnimationFrame(this.tick);
	}

	start() {
		if (this.running) return;
		this.running = true;
		this.raf = window.requestAnimationFrame(this.tick);
	}

	stop() {
		this.running = false;
		window.cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.lastFrameTime = 0;
	}

	syncAnimation() {
		// Continuous rendering is allowed only while motion is permitted, the page is
		// visible, and enough of the stage intersects the viewport.
		if (this.reducedMotion || this.pageHidden || !this.inView) {
			this.stop();
			if (this.reducedMotion) this.renderStatic();
			return;
		}

		this.start();
	}

	handleVisibility() {
		this.pageHidden = document.hidden;
		this.syncAnimation();
	}

	handleMotionPreference(event) {
		this.reducedMotion = event.matches;
		this.syncAnimation();
	}

	handleThemeChange() {
		this.params.paper = cssToken('--color-background', DEFAULT_PARAMS.paper);
		this.params.ink = cssToken('--color-text', DEFAULT_PARAMS.ink);
		this.params.accent = cssToken('--color-accent', DEFAULT_PARAMS.accent);
		this.applyColors();
		this.renderFrame();
	}

	destroy() {
		this.stop();
		window.cancelAnimationFrame(this.resizeFrame);
		this.resizeObserver.disconnect();
		this.intersectionObserver.disconnect();
		this.motionPreference.removeEventListener?.('change', this.handleMotionPreference);
		document.removeEventListener('visibilitychange', this.handleVisibility);
		document.removeEventListener('site-theme-change', this.handleThemeChange);
		this.canvas.remove();
	}
}

class KineticTextElement extends HTMLElement {
	connectedCallback() {
		if (this.engine) return;

		this.engine = new KineticText(this, {
			text: this.dataset.text || DEFAULT_PARAMS.text,
			paper: cssToken('--color-background', DEFAULT_PARAMS.paper),
			ink: cssToken('--color-text', DEFAULT_PARAMS.ink),
			accent: cssToken('--color-accent', DEFAULT_PARAMS.accent),
		});
	}

	disconnectedCallback() {
		this.engine?.destroy();
		this.engine = null;
	}
}

if (!customElements.get('kinetic-text')) {
	customElements.define('kinetic-text', KineticTextElement);
}
