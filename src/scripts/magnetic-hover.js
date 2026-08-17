// The wrapper remains stationary and owns pointer hit-testing; only its child target
// moves. Measuring a transformed hit area would otherwise make the effect jitter.
const clamp = (value, minimum, maximum) => (
	Math.min(Math.max(value, minimum), maximum)
);

const initializedElements = new WeakSet();
const controllers = [];
let sharedPreferences = null;
let sharedListenersInitialized = false;

const getSharedPreferences = () => {
	sharedPreferences ??= {
		finePointer: window.matchMedia('(hover: hover) and (pointer: fine)'),
		reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)'),
	};

	return sharedPreferences;
};

const pruneDetachedControllers = () => {
	for (let index = controllers.length - 1; index >= 0; index -= 1) {
		if (!controllers[index].element.isConnected) controllers.splice(index, 1);
	}
};

const resetUnavailable = () => {
	pruneDetachedControllers();
	// Media-query capabilities can change while a control is displaced. Reset it
	// immediately rather than leaving an inline transform behind.
	controllers.forEach(({ isEnabled, reset }) => {
		if (!isEnabled()) reset(true);
	});
};

const resetAll = () => {
	pruneDetachedControllers();
	controllers.forEach(({ reset }) => reset(true));
};

const initializeSharedListeners = () => {
	if (sharedListenersInitialized) return;

	const { finePointer, reducedMotion } = getSharedPreferences();
	finePointer.addEventListener?.('change', resetUnavailable);
	reducedMotion.addEventListener?.('change', resetUnavailable);
	window.addEventListener('blur', resetAll);
	sharedListenersInitialized = true;
};

export const initMagneticHover = (root) => {
	if (!root) return;

	pruneDetachedControllers();
	initializeSharedListeners();
	const { finePointer, reducedMotion } = getSharedPreferences();

	// Data attributes let each component tune strength, travel, and responsive scope
	// without creating another component-specific pointer controller.
	root.querySelectorAll('[data-magnetic]').forEach((element) => {
		if (initializedElements.has(element)) return;

		const target = element.querySelector('[data-magnetic-target]');
		if (!(target instanceof HTMLElement) || !(element instanceof HTMLElement)) return;
		initializedElements.add(element);

		const configuredOffset = Number.parseFloat(element.dataset.magneticMax || '');
		const configuredStrength = Number.parseFloat(element.dataset.magneticStrength || '');
		const maxOffset = Number.isFinite(configuredOffset) ? configuredOffset : 8;
		const strength = Number.isFinite(configuredStrength) ? configuredStrength : 0.18;
		const responsiveQuery = element.dataset.magneticQuery
			? window.matchMedia(element.dataset.magneticQuery)
			: null;
		let currentX = 0;
		let currentY = 0;
		let targetX = 0;
		let targetY = 0;
		let animationFrame = null;
		let isPressed = false;

		const isEnabled = () => (
			finePointer.matches &&
			!reducedMotion.matches &&
			(!responsiveQuery || responsiveQuery.matches)
		);

		const render = () => {
			// Exponential interpolation gives the target a soft spring-like approach while
			// the settled threshold guarantees that the RAF loop eventually stops.
			currentX += (targetX - currentX) * 0.18;
			currentY += (targetY - currentY) * 0.18;

			const settled = (
				Math.abs(targetX - currentX) < 0.02 &&
				Math.abs(targetY - currentY) < 0.02
			);

			if (settled) {
				currentX = targetX;
				currentY = targetY;
			}

			target.style.transform = `translate3d(${currentX.toFixed(2)}px, ${currentY.toFixed(2)}px, 0)`;

			if (settled) {
				animationFrame = null;
				return;
			}

			animationFrame = requestAnimationFrame(render);
		};

		const requestRender = () => {
			if (animationFrame === null) animationFrame = requestAnimationFrame(render);
		};

		const reset = (immediate = false) => {
			targetX = 0;
			targetY = 0;

			if (immediate) {
				if (animationFrame !== null) cancelAnimationFrame(animationFrame);
				animationFrame = null;
				currentX = 0;
				currentY = 0;
				target.style.transform = '';
				return;
			}

			requestRender();
		};

		element.addEventListener('pointermove', (event) => {
			if (!isEnabled() || event.pointerType !== 'mouse' || isPressed) return;

			const bounds = element.getBoundingClientRect();
			if (bounds.width === 0 || bounds.height === 0) return;

			targetX = clamp(
				(event.clientX - bounds.left - bounds.width / 2) * strength,
				-maxOffset,
				maxOffset,
			);
			targetY = clamp(
				(event.clientY - bounds.top - bounds.height / 2) * strength,
				-maxOffset,
				maxOffset,
			);
			requestRender();
		});

		const releaseAndReset = () => {
			isPressed = false;
			reset();
		};

		element.addEventListener('pointerleave', releaseAndReset);
		element.addEventListener('pointerdown', () => {
			// Stop accepting pointer updates while pressed and ease the target back toward
			// its native position during activation.
			isPressed = true;
			reset();
		});
		element.addEventListener('pointerup', () => {
			isPressed = false;
		});
		element.addEventListener('pointercancel', releaseAndReset);

		controllers.push({ element, isEnabled, reset });
		responsiveQuery?.addEventListener?.('change', resetUnavailable);
	});
};
