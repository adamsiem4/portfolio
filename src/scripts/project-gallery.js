const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const initializeProjectGallery = (gallery) => {
	// Keep setup idempotent so rerunning the initializer cannot duplicate listeners.
	if (gallery.dataset.projectGalleryReady === 'true') return;

	const shell = gallery.closest('.project-card__media-shell');
	const frames = Array.from(gallery.querySelectorAll('.project-card__image-frame'));
	const previousButton = shell?.querySelector('[data-gallery-previous]');
	const nextButton = shell?.querySelector('[data-gallery-next]');
	const status = shell?.querySelector('[data-gallery-status]');
	if (frames.length < 2 || !previousButton || !nextButton) return;

	let activeIndex = 0;
	let scrollFrame = null;
	let programmaticTargetIndex = null;
	let programmaticScrollTimer = null;

	const updateGalleryState = (nextIndex, announce = true) => {
		// Keep controls, aria-current, the data API, and the live region synchronized
		// whether navigation came from a button or manual scrolling.
		const indexChanged = nextIndex !== activeIndex;
		activeIndex = nextIndex;
		gallery.dataset.activeIndex = String(activeIndex);

		frames.forEach((frame, index) => {
			if (index === activeIndex) frame.setAttribute('aria-current', 'true');
			else frame.removeAttribute('aria-current');
		});

		previousButton.disabled = activeIndex === 0;
		nextButton.disabled = activeIndex === frames.length - 1;

		if (announce && indexChanged && status) {
			const description = frames[activeIndex].querySelector('img')?.alt ?? '';
			status.textContent = `Showing image ${activeIndex + 1} of ${frames.length}: ${description}`;
		}
	};

	const updateControls = (announce = true) => {
		const galleryTop = gallery.scrollTop;
		if (programmaticTargetIndex !== null) {
			// During smooth scrolling, intermediate frames can momentarily be closest.
			// Hold the requested index until its frame actually reaches the snap point.
			const targetDistance = Math.abs(
				frames[programmaticTargetIndex].offsetTop - galleryTop,
			);

			if (targetDistance > 1) {
				scrollFrame = null;
				return;
			}

			programmaticTargetIndex = null;
			clearTimeout(programmaticScrollTimer);
			programmaticScrollTimer = null;
		}

		let closestDistance = Number.POSITIVE_INFINITY;
		const closestIndex = frames.reduce((currentClosestIndex, frame, index) => {
			const frameDistance = Math.abs(frame.offsetTop - galleryTop);
			if (frameDistance >= closestDistance) return currentClosestIndex;

			closestDistance = frameDistance;
			return index;
		}, 0);

		updateGalleryState(closestIndex, announce);
		scrollFrame = null;
	};

	const moveTo = (nextIndex) => {
		const clampedIndex = Math.min(Math.max(nextIndex, 0), frames.length - 1);
		updateGalleryState(clampedIndex);
		programmaticTargetIndex = clampedIndex;
		clearTimeout(programmaticScrollTimer);
		programmaticScrollTimer = setTimeout(() => {
			// Timeout recovery handles interrupted smooth scrolls and browsers that settle
			// a fraction outside the one-pixel completion tolerance.
			programmaticTargetIndex = null;
			programmaticScrollTimer = null;
			updateControls();
		}, 1_000);
		gallery.scrollTo({
			top: frames[activeIndex].offsetTop,
			behavior: reducedMotion.matches ? 'auto' : 'smooth',
		});
	};

	const initializeScrollHint = () => {
		// The hint plays once per viewport visit, only after the gallery is substantially
		// visible. Leaving almost completely re-arms it for a later visit.
		if (reducedMotion.matches || !('IntersectionObserver' in window)) return;

		const track = gallery.querySelector('.project-card__media-track');
		if (!track) return;
		let isArmed = true;
		let isHinting = false;
		let hintDelay = null;
		let visibleRatio = 0;

		const clearHintDelay = () => {
			if (hintDelay === null) return;
			clearTimeout(hintDelay);
			hintDelay = null;
		};

		const clearHint = () => {
			delete gallery.dataset.galleryHinting;
			isHinting = false;
		};

		track.addEventListener('animationend', clearHint);
		track.addEventListener('animationcancel', clearHint);

		const observer = new IntersectionObserver(([entry]) => {
			visibleRatio = entry.intersectionRatio;

			if (!entry.isIntersecting || entry.intersectionRatio <= 0.1) {
				isArmed = true;
				clearHintDelay();
				if (isHinting) clearHint();
				return;
			}

			if (
				entry.intersectionRatio < 0.45
				|| !isArmed
				|| isHinting
				|| reducedMotion.matches
			) {
				if (entry.intersectionRatio < 0.45) clearHintDelay();
				return;
			}

			if (hintDelay !== null) return;
			hintDelay = setTimeout(() => {
				hintDelay = null;
				if (visibleRatio < 0.45 || !isArmed || reducedMotion.matches) return;

				isArmed = false;
				isHinting = true;
				gallery.dataset.galleryHinting = 'true';
			}, 700);
		}, { threshold: [0, 0.1, 0.45] });

		observer.observe(gallery);
	};

	previousButton.addEventListener('click', () => moveTo(activeIndex - 1));
	nextButton.addEventListener('click', () => moveTo(activeIndex + 1));
	gallery.addEventListener('scroll', () => {
		// Coalesce rapid scroll events into one layout measurement per paint frame.
		if (scrollFrame === null) scrollFrame = requestAnimationFrame(updateControls);
	}, { passive: true });

	updateControls(false);
	initializeScrollHint();
	gallery.dataset.projectGalleryReady = 'true';
};

document.querySelectorAll('[data-project-gallery]').forEach(initializeProjectGallery);
