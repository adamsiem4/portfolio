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

function rgba([red, green, blue], alpha = 1) {
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
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
		this.running = false;
		this.inView = true;
		this.pageHidden = document.hidden;
		this.box = { x0: 0, y0: 0, x1: 0, y1: 0 };

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

		this.mask = document.createElement('canvas');
		this.warp = document.createElement('canvas');
		this.tint = document.createElement('canvas');

		this.ctx = this.canvas.getContext('2d');
		this.maskContext = this.mask.getContext('2d', { willReadFrequently: true });
		this.warpContext = this.warp.getContext('2d');
		this.tintContext = this.tint.getContext('2d');

		if (!this.ctx || !this.maskContext || !this.warpContext || !this.tintContext) {
			throw new Error('Canvas 2D rendering is not supported in this browser.');
		}

		this.tick = this.tick.bind(this);
		this.handleVisibility = this.handleVisibility.bind(this);
		this.handleMotionPreference = this.handleMotionPreference.bind(this);

		this.applyColors();
		this.motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
		this.reducedMotion = this.motionPreference.matches;
		this.motionPreference.addEventListener?.('change', this.handleMotionPreference);

		this.resizeObserver = new ResizeObserver(() => this.resize());
		this.resizeObserver.observe(this.stage);

		this.intersectionObserver = new IntersectionObserver(([entry]) => {
			this.inView = entry?.isIntersecting ?? true;
			this.syncAnimation();
		});
		this.intersectionObserver.observe(this.stage);

		document.addEventListener('visibilitychange', this.handleVisibility);
		this.resize();
		this.syncAnimation();

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

		this.dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.width = Math.round(bounds.width * this.dpr);
		this.height = Math.round(bounds.height * this.dpr);

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
		const isMobile = this.width / this.dpr < 768;
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
		const measuredWidth = context.measureText(text).width;
		if (measuredWidth > maxWidth) {
			fontSize = Math.max(12, Math.floor(fontSize * (maxWidth / measuredWidth)));
			setFont();
		}

		context.fillText(text, this.width / 2, this.height / 2);
		this.measureInkBounds();
	}

	measureInkBounds() {
		try {
			const pixels = this.maskContext.getImageData(0, 0, this.width, this.height).data;
			let x0 = this.width;
			let y0 = this.height;
			let x1 = 0;
			let y1 = 0;

			for (let y = 0; y < this.height; y += 2) {
				for (let x = 0; x < this.width; x += 2) {
					if (pixels[(y * this.width + x) * 4 + 3] <= 20) continue;
					x0 = Math.min(x0, x);
					y0 = Math.min(y0, y);
					x1 = Math.max(x1, x);
					y1 = Math.max(y1, y);
				}
			}

			this.box = x1 >= x0
				? { x0, y0, x1, y1 }
				: { x0: 0, y0: 0, x1: this.width, y1: this.height };
		} catch {
			this.box = { x0: 0, y0: 0, x1: this.width, y1: this.height };
		}
	}

	renderFrame() {
		if (!this.width || !this.height) return;

		const context = this.warpContext;
		const { tiles, offset, speed, spread, shade } = this.params;
		const isMobile = this.width / this.dpr < 768;
		const motionScale = isMobile ? 0.5 : 1;
		const activeSpread = spread * motionScale;
		const tilesX = Math.max(2, Math.round(tiles));
		const tilesY = Math.max(2, Math.round(tilesX * (this.height / this.width)));
		const tileWidth = Math.floor(this.width / tilesX);
		const tileHeight = Math.floor(this.height / tilesY);
		const displacement = offset * motionScale * this.dpr;

		context.globalCompositeOperation = 'source-over';
		context.globalAlpha = 1;
		context.clearRect(0, 0, this.width, this.height);

		if (tileWidth > 0 && tileHeight > 0) {
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

	tick() {
		if (!this.running) return;
		this.frame += 1;
		this.renderFrame();
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
	}

	syncAnimation() {
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

	destroy() {
		this.stop();
		this.resizeObserver.disconnect();
		this.intersectionObserver.disconnect();
		this.motionPreference.removeEventListener?.('change', this.handleMotionPreference);
		document.removeEventListener('visibilitychange', this.handleVisibility);
		this.canvas.remove();
	}
}

class KineticTextElement extends HTMLElement {
	connectedCallback() {
		if (this.engine) return;

		this.engine = new KineticText(this, {
			text: this.dataset.text || DEFAULT_PARAMS.text,
			paper: cssToken('--color-background', DEFAULT_PARAMS.paper),
			ink: '#ffffff',
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
