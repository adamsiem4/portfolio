const initializeProjectGallery = (gallery) => {
	if (gallery.dataset.projectGalleryReady === 'true') return;

	const shell = gallery.closest('.project-card__media-shell');
	const frames = Array.from(gallery.querySelectorAll('.project-card__image-frame'));
	const previousButton = shell?.querySelector('[data-gallery-previous]');
	const nextButton = shell?.querySelector('[data-gallery-next]');
	if (frames.length < 2 || !previousButton || !nextButton) return;

	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
	let activeIndex = 0;
	let scrollFrame = null;

	const updateControls = () => {
		const galleryTop = gallery.scrollTop;
		activeIndex = frames.reduce((closestIndex, frame, index) => {
			const closestDistance = Math.abs(frames[closestIndex].offsetTop - galleryTop);
			const frameDistance = Math.abs(frame.offsetTop - galleryTop);
			return frameDistance < closestDistance ? index : closestIndex;
		}, 0);

		previousButton.disabled = activeIndex === 0;
		nextButton.disabled = activeIndex === frames.length - 1;
		scrollFrame = null;
	};

	const moveTo = (nextIndex) => {
		activeIndex = Math.min(Math.max(nextIndex, 0), frames.length - 1);
		previousButton.disabled = activeIndex === 0;
		nextButton.disabled = activeIndex === frames.length - 1;
		gallery.scrollTo({
			top: frames[activeIndex].offsetTop,
			behavior: reducedMotion.matches ? 'auto' : 'smooth',
		});
	};

	const initializeScrollHint = () => {
		if (reducedMotion.matches || !('IntersectionObserver' in window)) return;

		const track = gallery.querySelector('.project-card__media-track');
		if (!track) return;
		let isArmed = true;
		let isHinting = false;

		const clearHint = () => {
			delete gallery.dataset.galleryHinting;
			isHinting = false;
		};

		track.addEventListener('animationend', clearHint);
		track.addEventListener('animationcancel', clearHint);

		const observer = new IntersectionObserver((entries) => {
			const entry = entries.find((item) => item.target === gallery);
			if (!entry) return;

			if (!entry.isIntersecting || entry.intersectionRatio <= 0.1) {
				isArmed = true;
				if (isHinting) clearHint();
				return;
			}

			if (
				entry.intersectionRatio < 0.45
				|| !isArmed
				|| isHinting
				|| reducedMotion.matches
			) return;

			isArmed = false;
			isHinting = true;
			gallery.dataset.galleryHinting = 'true';
		}, { threshold: [0, 0.1, 0.45] });

		observer.observe(gallery);
	};

	previousButton.addEventListener('click', () => moveTo(activeIndex - 1));
	nextButton.addEventListener('click', () => moveTo(activeIndex + 1));
	gallery.addEventListener('scroll', () => {
		if (scrollFrame === null) scrollFrame = requestAnimationFrame(updateControls);
	}, { passive: true });

	updateControls();
	initializeScrollHint();
	gallery.dataset.projectGalleryReady = 'true';
};

const initializeProjectGalleries = () => {
	document.querySelectorAll('[data-project-gallery]').forEach(initializeProjectGallery);
};

initializeProjectGalleries();
document.addEventListener('astro:page-load', initializeProjectGalleries);
