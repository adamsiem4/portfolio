const SCRAMBLE_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&';
const UPDATE_INTERVAL = 30;
const REVEAL_STEP = 0.35;
const headingTimers = new WeakMap();

const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const headings = document.querySelectorAll('[data-scramble-heading]');

const getHeadingText = (heading) => heading.dataset.scrambleText ?? heading.textContent ?? '';

const stopScramble = (heading) => {
	const timer = headingTimers.get(heading);

	if (timer !== undefined) {
		window.clearInterval(timer);
		headingTimers.delete(heading);
	}

	heading.textContent = getHeadingText(heading);
};

const getRandomCharacter = () => (
	SCRAMBLE_CHARACTERS[Math.floor(Math.random() * SCRAMBLE_CHARACTERS.length)]
);

const scrambleHeading = (heading) => {
	stopScramble(heading);

	if (motionPreference.matches) return;

	const text = getHeadingText(heading);
	const characters = Array.from(text);
	let revealProgress = 0;

	const timer = window.setInterval(() => {
		heading.textContent = characters
			.map((character, index) => {
				if (/\s/.test(character)) return character;
				return index < revealProgress ? character : getRandomCharacter();
			})
			.join('');

		revealProgress += REVEAL_STEP;

		if (revealProgress >= characters.length) stopScramble(heading);
	}, UPDATE_INTERVAL);

	headingTimers.set(heading, timer);
};

if (headings.length > 0 && 'IntersectionObserver' in window) {
	const observer = new IntersectionObserver((entries) => {
		entries.forEach((entry) => {
			if (entry.isIntersecting) scrambleHeading(entry.target);
			else stopScramble(entry.target);
		});
	}, {
		rootMargin: '0px 0px -20% 0px',
	});

	headings.forEach((heading) => observer.observe(heading));
}

const handleMotionPreferenceChange = () => {
	headings.forEach((heading) => stopScramble(heading));
};

if ('addEventListener' in motionPreference) {
	motionPreference.addEventListener('change', handleMotionPreferenceChange);
} else {
	motionPreference.addListener(handleMotionPreferenceChange);
}
