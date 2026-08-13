const SWIPE_THRESHOLD = 48;
const DIRECTION_THRESHOLD = 7;
const MAX_DRAG_DISTANCE = 110;

const clamp = (value, minimum, maximum) => Math.min(Math.max(value, minimum), maximum);
const formatPosition = (position) => String(position).padStart(2, '0');

const initializeProjectDeck = (deck) => {
	if (deck.dataset.projectDeckReady === 'true') return;

	const slides = Array.from(deck.querySelectorAll('[data-project-slide]'));
	if (slides.length === 0) return;
	const slideParts = slides.map((slide) => ({
		content: slide.querySelector('[data-project-content]'),
		activateButton: slide.querySelector('[data-project-activate]'),
	}));

	const previousButton = deck.querySelector('[data-project-previous]');
	const nextButton = deck.querySelector('[data-project-next]');
	const position = deck.querySelector('[data-project-position]');
	const status = deck.querySelector('[data-project-status]');
	let activeIndex = clamp(Number(deck.dataset.activeIndex) || 0, 0, slides.length - 1);
	let pointerState = null;
	let suppressClick = false;

	const updateDeck = (nextIndex, announce = true) => {
		activeIndex = clamp(nextIndex, 0, slides.length - 1);
		deck.dataset.activeIndex = String(activeIndex);

		slides.forEach((slide, index) => {
			const offset = index - activeIndex;
			const distanceFromActive = Math.abs(offset);
			const direction = Math.sign(offset);
			const x = offset === 0 ? 0 : direction * (12 + ((distanceFromActive - 1) * 10));
			const angle = offset === 0
				? 0
				: direction * Math.min(0.7 + (distanceFromActive * 0.2), 1.5);
			const layer = offset === 0 ? slides.length + 1 : slides.length - distanceFromActive;
			const isActive = index === activeIndex;
			const { content, activateButton } = slideParts[index];

			slide.dataset.active = String(isActive);
			slide.dataset.side = offset < 0 ? 'previous' : offset > 0 ? 'next' : 'active';
			if (isActive) slide.setAttribute('aria-current', 'true');
			else slide.removeAttribute('aria-current');
			slide.style.setProperty('--card-x', `${x}px`);
			slide.style.setProperty('--card-angle', `${angle}deg`);
			slide.style.setProperty('--card-layer', String(layer));

			if (content) {
				content.toggleAttribute('inert', !isActive);
				content.setAttribute('aria-hidden', String(!isActive));
			}

			if (activateButton) {
				activateButton.tabIndex = isActive ? -1 : 0;
				activateButton.setAttribute('aria-hidden', String(isActive));
			}
		});

		if (previousButton) previousButton.disabled = activeIndex === 0;
		if (nextButton) nextButton.disabled = activeIndex === slides.length - 1;
		if (position) {
			position.textContent = `${formatPosition(activeIndex + 1)} / ${formatPosition(slides.length)}`;
		}

		if (announce && status) {
			const title = slides[activeIndex].dataset.projectTitle ?? '';
			status.textContent = `Showing project ${activeIndex + 1} of ${slides.length}: ${title}`;
		}
	};

	const moveTo = (nextIndex, returnFocus = false) => {
		if (nextIndex === activeIndex || nextIndex < 0 || nextIndex >= slides.length) return;
		updateDeck(nextIndex);
		if (returnFocus) deck.focus({ preventScroll: true });
	};

	previousButton?.addEventListener('click', () => moveTo(activeIndex - 1));
	nextButton?.addEventListener('click', () => moveTo(activeIndex + 1));

	slideParts.forEach(({ activateButton }, index) => {
		activateButton?.addEventListener('click', () => {
			moveTo(index, true);
		});
	});

	deck.addEventListener('keydown', (event) => {
		if (event.defaultPrevented || event.target.closest('button, a')) return;

		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			moveTo(activeIndex - 1, true);
		}

		if (event.key === 'ArrowRight') {
			event.preventDefault();
			moveTo(activeIndex + 1, true);
		}
	});

	deck.addEventListener('pointerdown', (event) => {
		if (
			slides.length < 2
			|| (event.pointerType === 'mouse' && event.button !== 0)
			|| event.target.closest('button, .project-card__source, .project-card__action')
		) return;

		pointerState = {
			id: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			dragX: 0,
			direction: null,
		};
	});

	deck.addEventListener('pointermove', (event) => {
		if (!pointerState || event.pointerId !== pointerState.id) return;

		const deltaX = event.clientX - pointerState.startX;
		const deltaY = event.clientY - pointerState.startY;

		if (pointerState.direction === null) {
			if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DIRECTION_THRESHOLD) return;

			if (Math.abs(deltaY) > Math.abs(deltaX)) {
				pointerState = null;
				return;
			}

			pointerState.direction = 'horizontal';
			deck.setPointerCapture(event.pointerId);
			deck.dataset.dragging = 'true';
		}

		event.preventDefault();
		const isPastStart = activeIndex === 0 && deltaX > 0;
		const isPastEnd = activeIndex === slides.length - 1 && deltaX < 0;
		const resistance = isPastStart || isPastEnd ? 0.28 : 1;
		pointerState.dragX = clamp(deltaX * resistance, -MAX_DRAG_DISTANCE, MAX_DRAG_DISTANCE);
		deck.style.setProperty('--deck-drag-x', `${pointerState.dragX}px`);
	});

	const finishPointerGesture = (event, cancelled = false) => {
		if (!pointerState || event.pointerId !== pointerState.id) return;

		const wasDragging = pointerState.direction === 'horizontal';
		const dragX = pointerState.dragX;
		const pointerId = pointerState.id;
		pointerState = null;
		deck.dataset.dragging = 'false';
		deck.style.setProperty('--deck-drag-x', '0px');

		if (deck.hasPointerCapture(pointerId)) deck.releasePointerCapture(pointerId);

		if (!cancelled && wasDragging && Math.abs(dragX) >= SWIPE_THRESHOLD) {
			moveTo(activeIndex + (dragX < 0 ? 1 : -1));
		}

		if (wasDragging) {
			suppressClick = true;
			window.setTimeout(() => {
				suppressClick = false;
			}, 0);
		}
	};

	deck.addEventListener('pointerup', (event) => finishPointerGesture(event));
	deck.addEventListener('pointercancel', (event) => finishPointerGesture(event, true));
	deck.addEventListener('click', (event) => {
		if (!suppressClick) return;
		event.preventDefault();
		event.stopPropagation();
	}, true);
	deck.addEventListener('dragstart', (event) => event.preventDefault());

	updateDeck(activeIndex, false);
	deck.dataset.projectDeckReady = 'true';
};

document.querySelectorAll('[data-project-deck]').forEach(initializeProjectDeck);
