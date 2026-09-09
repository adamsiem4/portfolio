import { siteConfig } from '../config/site.js';

export const defaultLocale = 'pl';

export const localeMeta = {
	pl: { htmlLang: 'pl', ogLocale: 'pl_PL', home: '/', short: 'PL' },
	en: { htmlLang: 'en', ogLocale: 'en_US', home: '/en/', short: 'EN' },
};

/** `/en/...` is the only prefixed route; everything else is Polish. */
export const getLocale = (url) => (url.pathname.startsWith('/en') ? 'en' : 'pl');

const ui = {
	pl: {
		"meta.title": siteConfig.seoTitle,
		"meta.description": siteConfig.seoDescription,
		"meta.keywords": siteConfig.seoKeywords.join(', '),
		"meta.socialTitle": siteConfig.socialTitle,
		"meta.socialDescription": siteConfig.socialDescription,
		"meta.socialImageAlt": siteConfig.socialImage.alt,
		"skip": "Przejdź do treści",
		"loader": "Ładowanie portfolio",
		"nav.primary": "Nawigacja główna",
		"nav.menu": "Przełącz nawigację",
		"nav.about": "O mnie",
		"nav.projects": "Projekty",
		"nav.contact": "Kontakt",
		"theme.light": "Przełącz na tryb jasny",
		"theme.dark": "Przełącz na tryb ciemny",
		"hero.eyebrow": "Cześć, nazywam się",
		"hero.scroll": "Przewiń do sekcji O mnie",
		"about.title": "O mnie",
		"projects.title": "Projekty",
		"projects.carousel": "karuzela",
		"projects.slide": "slajd",
		"projects.deckLabel": "Wybrane projekty, {total} projekty. Użyj przycisków w lewo i w prawo albo strzałek.",
		"projects.slideLabel": "{index} z {total}: {title}",
		"projects.activate": "Pokaż {title}",
		"projects.controls": "Nawigacja projektów",
		"projects.previous": "Pokaż poprzedni projekt",
		"projects.next": "Pokaż następny projekt",
		"projects.status": "Pokazywany projekt {index} z {total}: {title}",
		"projects.instructions": "Użyj strzałek w lewo i w prawo, przycisków nawigacji lub przesuń poziomo, aby zmienić projekt.",
		"card.eyebrow": "Projekt",
		"card.openLive": "Otwórz stronę {title} w nowej karcie",
		"card.viewLive": "Zobacz działający projekt",
		"card.galleryLabel": "Galeria zdjęć: {title}, {total} zdjęcia. Użyj przycisków w górę i w dół albo przewiń w pionie.",
		"card.galleryControls": "Nawigacja zdjęć: {title}",
		"card.galleryPrevious": "Pokaż poprzednie zdjęcie: {title}",
		"card.galleryNext": "Pokaż następne zdjęcie: {title}",
		"card.galleryStatus": "Pokazywane zdjęcie {index} z {total}: {description}",
		"card.role": "Rola",
		"card.challenge": "Wyzwanie",
		"card.outcome": "Rezultat",
		"card.stack": "Technologie: {title}",
		"card.privateRepo": "Prywatne repozytorium {provider}",
		"card.privateRepoText": "Prywatne repozytorium źródłowe {provider}",
		"card.openRepo": "Otwórz repozytorium źródłowe {provider} w nowej karcie",
		"card.repoTitle": "Repozytorium {provider}",
		"card.openLiveTitle": "Otwórz działającą stronę",
		"contact.eyebrow": "Dane kontaktowe",
		"contact.title": "Napisz do mnie",
		"contact.email": "Napisz na {email}",
		"footer.privacy": "Informacja o prywatności i danych",
		"footer.privacyClose": "Zamknij informację o prywatności",
		"footer.providerLabel": "Przeczytaj politykę prywatności Cloudflare",
		"footer.provider": "Polityka prywatności Cloudflare",
		"footer.top": "Do góry",
		"footer.language": "Wybór języka",
		"footer.switchPl": "Zmień język na polski",
		"footer.switchEn": "Zmień język na angielski",
		"privacy.title": siteConfig.privacyNotice.title,
		"privacy.summary": siteConfig.privacyNotice.summary,
		"privacy.preference": siteConfig.privacyNotice.preference,
		"privacy.hosting": siteConfig.privacyNotice.hosting,
		"privacy.contact": siteConfig.privacyNotice.contact,
		"notFound.title": "Nie znaleziono strony",
		"notFound.description": "Nie znaleziono żądanej strony. Wróć do portfolio Adama Salickiego.",
		"notFound.heading": "Trafiłeś w ślepą uliczkę.",
		"notFound.body": "Strona mogła zostać przeniesiona lub adres jest nieprawidłowy. Portfolio nadal czeka na starcie.",
		"notFound.back": "Wróć do portfolio",
	},
	en: {
		"meta.title": "Adam Salicki | Developer & Creative Portfolio",
		"meta.description": "Explore Adam Salicki’s portfolio of web development projects, creative experiments, and ways to get in touch for collaborations and opportunities.",
		"meta.keywords": "Adam Salicki, cybersecurity portfolio, computer science graduate, entry-level cybersecurity, React developer, systems administration, Wazuh, Proxmox homelab",
		"meta.socialTitle": "Adam Salicki — Portfolio",
		"meta.socialDescription": "Front-end developer expanding into cybersecurity.",
		"meta.socialImageAlt": "Adam Salicki portfolio",
		"skip": "Skip to content",
		"loader": "Loading portfolio",
		"nav.primary": "Primary navigation",
		"nav.menu": "Toggle navigation",
		"nav.about": "About",
		"nav.projects": "Projects",
		"nav.contact": "Contact",
		"theme.light": "Switch to light mode",
		"theme.dark": "Switch to dark mode",
		"hero.eyebrow": "Hi, my name is",
		"hero.scroll": "Scroll to About",
		"about.title": "About me",
		"projects.title": "Projects",
		"projects.carousel": "carousel",
		"projects.slide": "slide",
		"projects.deckLabel": "Featured projects, {total} projects. Use the left and right controls or arrow keys.",
		"projects.slideLabel": "{index} of {total}: {title}",
		"projects.activate": "Show {title}",
		"projects.controls": "Project navigation",
		"projects.previous": "Show previous project",
		"projects.next": "Show next project",
		"projects.status": "Showing project {index} of {total}: {title}",
		"projects.instructions": "Use the left and right arrow keys, navigation buttons, or a horizontal swipe to change projects.",
		"card.eyebrow": "Project",
		"card.openLive": "Open {title} live website in a new tab",
		"card.viewLive": "View live project",
		"card.galleryLabel": "{title} image gallery, {total} images. Use the up and down controls or scroll vertically.",
		"card.galleryControls": "{title} image navigation",
		"card.galleryPrevious": "Show previous {title} image",
		"card.galleryNext": "Show next {title} image",
		"card.galleryStatus": "Showing image {index} of {total}: {description}",
		"card.role": "Role",
		"card.challenge": "Challenge",
		"card.outcome": "Outcome",
		"card.stack": "{title} technology stack",
		"card.privateRepo": "Private {provider} repository",
		"card.privateRepoText": "Private {provider} source repository",
		"card.openRepo": "Open {provider} source repository in a new tab",
		"card.repoTitle": "{provider} repository",
		"card.openLiveTitle": "Open live website",
		"contact.eyebrow": "Contact information",
		"contact.title": "Get in touch",
		"contact.email": "Email {email}",
		"footer.privacy": "Privacy and data notice",
		"footer.privacyClose": "Close privacy notice",
		"footer.providerLabel": "Read Cloudflare Privacy Policy",
		"footer.provider": "Cloudflare Privacy Policy",
		"footer.top": "Back to top",
		"footer.language": "Language selection",
		"footer.switchPl": "Switch language to Polish",
		"footer.switchEn": "Switch language to English",
		"privacy.title": "Privacy & data notice",
		"privacy.summary": "This static portfolio does not use advertising trackers, analytics beacons, tracking cookies, or contact forms.",
		"privacy.preference": "Your selected color theme and language are stored locally in your browser and are used only to remember those preferences.",
		"privacy.hosting": "The site is hosted on Cloudflare Pages. Cloudflare may process limited technical data, including IP addresses and request metadata, to deliver, secure, and operate its network.",
		"privacy.contact": "If you choose to email me, I use the information you provide only to respond to your message.",
		"notFound.title": "Page not found",
		"notFound.description": "The requested page could not be found. Return to Adam Salicki’s portfolio.",
		"notFound.heading": "You’ve reached a dead end.",
		"notFound.body": "The page may have moved, or the address may be incorrect. The portfolio is still waiting at the starting point.",
		"notFound.back": "Back to portfolio",
	},
};

export const useTranslations = (localeOrUrl) => {
	const locale = typeof localeOrUrl === 'string' ? localeOrUrl : getLocale(localeOrUrl);
	const strings = ui[locale];

	return (key, values) => {
		const value = strings[key];
		// Fail the build instead of shipping an English fallback into Polish copy.
		if (value === undefined) throw new Error(`Missing ${locale} translation for "${key}"`);
		return values
			? value.replace(/\{(\w+)\}/g, (_, name) => String(values[name]))
			: value;
	};
};

const projectCopyPl = {
	'touch-of-beauty': {
		eyebrow: 'Działająca strona',
		description: 'Strona salonu kosmetycznego z usługami, cennikiem, profilami zespołu i rezerwacją przez Booksy.',
		role: 'Rozwój full-stack',
		challenge: 'Umożliwić edycję treści salonu bez zakłócania rezerwacji w Booksy.',
		outcome: 'Wdrożona działająca strona z panelem administracyjnym za logowaniem.',
		imageAlts: [
			'Strona główna salonu Touch of Beauty',
			'Panel administracyjny Touch of Beauty z modułami zarządzania treścią',
		],
	},
	homelab: {
		title: 'Własny homelab',
		eyebrow: 'Laboratorium infrastruktury',
		description: 'Laboratorium na Proxmoksie: usługi w kontenerach, reverse proxy, filtrowanie DNS i monitoring infrastruktury.',
		role: 'Projektowanie i utrzymanie infrastruktury',
		challenge: 'Połączyć własny routing, filtrowanie DNS i monitoring w jednym łatwym w utrzymaniu laboratorium.',
		outcome: 'Zbudowane laboratorium na Proxmoksie i Debianie z Dockerem, AdGuard Home i Uptime Kuma.',
		imageAlts: [
			'Panel homelabu ze statusem usług, metrykami systemu i uruchomionymi kontenerami',
			'Własna szafa rack z serwerami, sprzętem sieciowym i macierzą dyskową',
		],
	},
	'pi-oled-stats-sh1106': {
		title: 'Monitor Raspberry Pi',
		eyebrow: 'Skrypt w Pythonie',
		description: 'Pokazuje nazwę hosta, adres IP, obciążenie CPU, temperaturę i użycie pamięci na wyświetlaczu OLED SH1106.',
		role: 'Python i integracja ze sprzętem',
		challenge: 'Zmieścić czytelną telemetrię na 1,3-calowym OLED SH1106 bez artefaktów obrazu.',
		outcome: 'Panel startujący razem z systemem, z ochroną OLED przed wypaleniem poza godzinami pracy.',
		imageAlts: [
			'Statystyki systemu Raspberry Pi na wyświetlaczu OLED SH1106',
			'Kod źródłowy w Pythonie dla wyświetlacza statusu SH1106 na Raspberry Pi',
		],
	},
	hedgehop: {
		eyebrow: 'Działająca strona',
		description: 'Platforma do nauki języków z fiszkami, lekcjami, śledzeniem postępów i dziennymi seriami.',
		role: 'Frontend i rozwój na Firebase',
		challenge: 'Zachować postęp nauki zarówno dla gości, jak i zalogowanych użytkowników.',
		outcome: 'Wdrożona responsywna aplikacja na Firebase z lekcjami, seriami i synchronizacją danych użytkownika.',
		imageAlts: [
			'Panel nauki języków HedgeHop',
			'Interfejs nauki w HedgeHop',
		],
	},
};

export const localizeProjects = (projects, locale) => {
	if (locale === 'en') return projects;

	return projects.map((project) => {
		const copy = projectCopyPl[project.slug];
		// A new project without Polish copy must break the build, not ship English.
		if (!copy) throw new Error(`Missing Polish copy for project "${project.slug}"`);
		const { imageAlts, ...text } = copy;

		return {
			...project,
			...text,
			images: project.images.map((image, index) => ({ ...image, alt: imageAlts[index] })),
		};
	});
};
