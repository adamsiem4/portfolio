const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);

const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const pointerEnabled = () => finePointer.matches && !reducedMotion.matches;

const initializedElements = new WeakSet();
const controllers = [];
let sharedListenersInitialized = false;

const pruneDetachedControllers = () => {
	for (let index = controllers.length - 1; index >= 0; index -= 1) {
		if (!controllers[index].element.isConnected) controllers.splice(index, 1);
	}
};

const resetUnavailable = () => {
	pruneDetachedControllers();
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
	finePointer.addEventListener?.('change', resetUnavailable);
	reducedMotion.addEventListener?.('change', resetUnavailable);
	window.addEventListener('blur', resetAll);
	sharedListenersInitialized = true;
};

// One coalescer for all three effects. render() may call request() again to keep
// looping (magnetic, eyebrow) or return (badge tilt) for a one-shot write.
const createScheduler = (render) => {
	let frame = null;

	return {
		request: () => {
			if (frame !== null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				render();
			});
		},
		cancel: () => {
			if (frame !== null) cancelAnimationFrame(frame);
			frame = null;
		},
	};
};

const initMagneticTargets = (root) => {
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
		let isPressed = false;

		const isEnabled = () => (
			pointerEnabled() && (!responsiveQuery || responsiveQuery.matches)
		);

		const render = () => {
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
			if (!settled) request();
		};

		const { request, cancel } = createScheduler(render);
		const reset = (immediate = false) => {
			targetX = 0;
			targetY = 0;

			if (immediate) {
				cancel();
				currentX = 0;
				currentY = 0;
				target.style.transform = '';
				return;
			}

			request();
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
			request();
		});

		const releaseAndReset = () => {
			isPressed = false;
			reset();
		};

		element.addEventListener('pointerleave', releaseAndReset);
		element.addEventListener('pointerdown', () => {
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

const initEyebrowRepel = (root) => {
	const element = root.querySelector('[data-eyebrow-repel]');
	if (!element || initializedElements.has(element)) return;

	const letters = Array.from(element.querySelectorAll('[data-eyebrow-letter]'));
	if (letters.length === 0) return;
	initializedElements.add(element);

	const influenceRadius = 80;
	const maximumOffset = 18;
	const offsets = letters.map(() => ({ current: 0, target: 0 }));

	const render = () => {
		let settled = true;

		offsets.forEach((offset, index) => {
			offset.current += (offset.target - offset.current) * 0.2;

			if (Math.abs(offset.target - offset.current) < 0.02) {
				offset.current = offset.target;
			} else {
				settled = false;
			}

			letters[index].style.transform = `translate3d(${offset.current.toFixed(2)}px, 0, 0)`;
		});

		if (!settled) request();
	};

	const { request, cancel } = createScheduler(render);
	const reset = (immediate = false) => {
		offsets.forEach((offset, index) => {
			offset.target = 0;

			if (immediate) {
				offset.current = 0;
				letters[index].style.transform = '';
			}
		});

		if (immediate) {
			cancel();
			return;
		}

		request();
	};

	element.addEventListener('pointermove', (event) => {
		if (!pointerEnabled() || event.pointerType !== 'mouse') return;

		const eyebrowBounds = element.getBoundingClientRect();
		const eyebrowCenter = eyebrowBounds.left + eyebrowBounds.width / 2;

		letters.forEach((letter, index) => {
			const letterBounds = letter.getBoundingClientRect();
			const letterCenter = letterBounds.left + letterBounds.width / 2 - offsets[index].current;
			const distance = letterCenter - event.clientX;
			const proximity = Math.max(0, 1 - Math.abs(distance) / influenceRadius);
			const direction = Math.sign(distance) || (letterCenter < eyebrowCenter ? -1 : 1);

			offsets[index].target = direction * maximumOffset * Math.pow(proximity, 1.5);
		});

		request();
	});

	element.addEventListener('pointerleave', () => reset());
	controllers.push({ element, isEnabled: pointerEnabled, reset });
};

const initBadgeTilt = (root) => {
	const element = root.querySelector('[data-cert-badge-tilt]');
	if (!element || initializedElements.has(element)) return;

	const target = element.querySelector('[data-cert-badge-tilt-target]');
	if (!target) return;
	initializedElements.add(element);

	let rotateX = 0;
	let rotateY = 0;

	const render = () => {
		target.style.setProperty('--cert-tilt-x', `${rotateX.toFixed(2)}deg`);
		target.style.setProperty('--cert-tilt-y', `${rotateY.toFixed(2)}deg`);
	};
	const { request, cancel } = createScheduler(render);
	const reset = () => {
		cancel();
		target.style.removeProperty('--cert-tilt-x');
		target.style.removeProperty('--cert-tilt-y');
	};

	element.addEventListener('pointermove', (event) => {
		if (event.pointerType !== 'mouse' || !pointerEnabled()) {
			reset();
			return;
		}

		const bounds = element.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return;

		rotateX = ((event.clientY - bounds.top) / bounds.height - 0.5) * -20;
		rotateY = ((event.clientX - bounds.left) / bounds.width - 0.5) * 20;
		request();
	});

	element.addEventListener('pointerleave', reset);
	element.addEventListener('pointercancel', reset);
	controllers.push({ element, isEnabled: pointerEnabled, reset });
};

export const initPointerEffects = (root) => {
	if (!root) return;

	pruneDetachedControllers();
	initializeSharedListeners();
	initMagneticTargets(root);
	initEyebrowRepel(root);
	initBadgeTilt(root);
};
