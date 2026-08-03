const clamp = (value, minimum, maximum) => (
	Math.min(Math.max(value, minimum), maximum)
);

export const initMagneticHover = (root) => {
	if (!root) return;

	const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	const controllers = [];

	root.querySelectorAll('[data-magnetic]').forEach((element) => {
		const target = element.querySelector('[data-magnetic-target]');
		if (!(target instanceof HTMLElement) || !(element instanceof HTMLElement)) return;

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

		element.addEventListener('pointerleave', () => {
			isPressed = false;
			reset();
		});
		element.addEventListener('pointerdown', () => {
			isPressed = true;
			reset();
		});
		element.addEventListener('pointerup', () => {
			isPressed = false;
		});
		element.addEventListener('pointercancel', () => {
			isPressed = false;
			reset();
		});

		controllers.push({ isEnabled, reset, responsiveQuery });
	});

	const resetUnavailable = () => {
		controllers.forEach(({ isEnabled, reset }) => {
			if (!isEnabled()) reset(true);
		});
	};
	const resetAll = () => {
		controllers.forEach(({ reset }) => reset(true));
	};

	finePointer.addEventListener?.('change', resetUnavailable);
	reducedMotion.addEventListener?.('change', resetUnavailable);
	controllers.forEach(({ responsiveQuery }) => {
		responsiveQuery?.addEventListener?.('change', resetUnavailable);
	});
	window.addEventListener('blur', resetAll);
};
