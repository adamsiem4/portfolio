import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { projects } from '../src/config/projects.js';
import { siteConfig } from '../src/config/site.js';

// Treat the JavaScript configs as the source of truth for public files that cannot
// import them at runtime. This turns hand-maintained metadata drift into a build error.
const failures = [];
const expect = (condition, message) => {
	if (!condition) failures.push(message);
};
const expectText = (content, expected, fileName, label) => {
	expect(
		content.includes(expected),
		`${fileName} is missing ${label}: ${expected}`,
	);
};
const publicName = (path) => path.replace(/^\/+/, '');
const publicFile = (path) => new URL(`../public/${publicName(path)}`, import.meta.url);
const readPublicFile = async (path, encoding = null) => {
	const name = publicName(path);

	try {
		return await readFile(publicFile(name), encoding ?? undefined);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		failures.push(`public/${name} could not be read: ${reason}`);
		return null;
	}
};

const manifestName = publicName(siteConfig.webManifest.path);
const [sitemap, robots, llms, headers, manifestSource] = await Promise.all([
	readPublicFile('sitemap.xml', 'utf8'),
	readPublicFile('robots.txt', 'utf8'),
	readPublicFile('llms.txt', 'utf8'),
	readPublicFile('_headers', 'utf8'),
	readPublicFile(manifestName, 'utf8'),
]);

const siteUrl = siteConfig.siteUrl.replace(/\/$/, '');
const homeUrl = `${siteUrl}/`;
const sitemapUrl = `${siteUrl}/sitemap.xml`;
const sitemapLocations = [...(sitemap ?? '').matchAll(/<loc>([^<]+)<\/loc>/g)]
	.map((match) => match[1].trim());
const robotsSitemaps = (robots ?? '')
	.split(/\r?\n/)
	.filter((line) => /^Sitemap:/i.test(line))
	.map((line) => line.replace(/^Sitemap:\s*/i, '').trim());

expect(
	sitemapLocations.length === 1 && sitemapLocations[0] === homeUrl,
	`public/sitemap.xml must contain exactly one canonical location: ${homeUrl}`,
);
expect(
	robotsSitemaps.length === 1 && robotsSitemaps[0] === sitemapUrl,
	`public/robots.txt must contain exactly one sitemap directive: Sitemap: ${sitemapUrl}`,
);

const parseHeaderRules = (content) => {
	const rules = [];
	let currentRule = null;

	content.split(/\r?\n/).forEach((line, lineIndex) => {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) return;

		if (!/^\s/.test(line)) {
			currentRule = {
				path: trimmed,
				headers: new Map(),
				detachedHeaders: [],
				directives: [],
			};
			rules.push(currentRule);
			return;
		}

		if (!currentRule) {
			failures.push(`public/_headers line ${lineIndex + 1} defines a header before a path rule`);
			return;
		}

		if (trimmed.startsWith('!')) {
			const name = trimmed.slice(1).trim().toLowerCase();
			if (!/^[!#$%&'*+.^_`|~\da-z-]+$/i.test(name)) {
				failures.push(`public/_headers line ${lineIndex + 1} has an invalid detached header: ${trimmed}`);
				return;
			}

			currentRule.detachedHeaders.push(name);
			currentRule.directives.push({ type: 'detach', name });
			return;
		}

		const separator = trimmed.indexOf(':');
		if (separator < 1) {
			failures.push(`public/_headers line ${lineIndex + 1} is not a valid header: ${trimmed}`);
			return;
		}

		const name = trimmed.slice(0, separator).trim().toLowerCase();
		const value = trimmed.slice(separator + 1).trim();
		const values = currentRule.headers.get(name) ?? [];
		values.push(value);
		currentRule.headers.set(name, values);
		currentRule.directives.push({ type: 'header', name, value });
	});

	return rules;
};

const headerRules = parseHeaderRules(headers ?? '');
const expectedHeaderRules = new Map([
	['/*', {
		detachedHeaders: [],
		headers: new Map([
			['x-robots-tag', siteConfig.notFoundRobots],
			...Object.entries(siteConfig.responseHeaders)
				.map(([name, value]) => [name.toLowerCase(), value]),
		]),
	}],
	['/', {
		detachedHeaders: ['x-robots-tag'],
		headers: new Map([['x-robots-tag', siteConfig.robots]]),
	}],
	['/404.html', {
		detachedHeaders: ['x-robots-tag'],
		headers: new Map([['x-robots-tag', siteConfig.notFoundRobots]]),
	}],
	['/_astro/*', {
		detachedHeaders: [],
		headers: new Map([['cache-control', siteConfig.assetCacheControl]]),
	}],
]);

expect(
	headerRules.length === expectedHeaderRules.size,
	`public/_headers must contain exactly ${expectedHeaderRules.size} configured path rules`,
);
expectedHeaderRules.forEach((expectedRule, path) => {
	const matchingRules = headerRules.filter((rule) => rule.path === path);
	expect(
		matchingRules.length === 1,
		`public/_headers must contain exactly one ${path} rule`,
	);
	const actualRule = matchingRules[0];
	if (!actualRule) return;

	expect(
		isDeepStrictEqual(actualRule.detachedHeaders, expectedRule.detachedHeaders),
		`public/_headers ${path} rule must detach exactly [${expectedRule.detachedHeaders.join(', ')}]`,
	);
	expect(
		actualRule.headers.size === expectedRule.headers.size,
		`public/_headers ${path} rule must contain exactly ${expectedRule.headers.size} configured headers`,
	);
	expectedRule.headers.forEach((expectedValue, name) => {
		const actualValues = actualRule.headers.get(name) ?? [];
		expect(
			actualValues.length === 1 && actualValues[0] === expectedValue,
			`public/_headers ${path} rule must set ${name} to the configured value: ${expectedValue}`,
		);
	});

	expectedRule.detachedHeaders.forEach((name) => {
		const detachIndex = actualRule.directives.findIndex(
			(directive) => directive.type === 'detach' && directive.name === name,
		);
		const attachIndex = actualRule.directives.findIndex(
			(directive) => directive.type === 'header' && directive.name === name,
		);
		expect(
			detachIndex >= 0 && detachIndex < attachIndex,
			`public/_headers ${path} rule must detach ${name} before setting its replacement`,
		);
	});
});

const contentSecurityPolicy = siteConfig.responseHeaders['Content-Security-Policy'];
const requiredSecurityHeaders = [
	'Content-Security-Policy',
	'Strict-Transport-Security',
	'X-Content-Type-Options',
	'Referrer-Policy',
	'Permissions-Policy',
	'X-Frame-Options',
];
requiredSecurityHeaders.forEach((name) => {
	expect(
		typeof siteConfig.responseHeaders[name] === 'string'
			&& siteConfig.responseHeaders[name].length > 0,
		`src/config/site.js must define the required ${name} response header`,
	);
});
expect(
	!contentSecurityPolicy.match(/script-src[^;]*'unsafe-(?:inline|eval)'/),
	"Content-Security-Policy script-src must not contain 'unsafe-inline' or 'unsafe-eval'",
);
expect(
	contentSecurityPolicy.includes("frame-ancestors 'none'"),
	"Content-Security-Policy must prevent framing with frame-ancestors 'none'",
);
expect(
	siteConfig.responseHeaders['Strict-Transport-Security'].includes('includeSubDomains')
		&& Number.parseInt(
			siteConfig.responseHeaders['Strict-Transport-Security'].match(/max-age=(\d+)/)?.[1] ?? '0',
			10,
		) >= 31_536_000,
	'Strict-Transport-Security must cover subdomains for at least one year',
);
expect(
	siteConfig.responseHeaders['X-Content-Type-Options'] === 'nosniff',
	'X-Content-Type-Options must be nosniff',
);
expect(
	siteConfig.responseHeaders['X-Frame-Options'] === 'DENY',
	'X-Frame-Options must deny framing for legacy clickjacking protection',
);
expect(
	(headers ?? '').split(/\r?\n/).every((line) => line.length <= 2_000),
	'public/_headers lines must stay within the Cloudflare Pages 2,000-character limit',
);

let manifest = null;
if (manifestSource !== null) {
	try {
		manifest = JSON.parse(manifestSource);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		failures.push(`public/${manifestName} is not valid JSON: ${reason}`);
	}
}

const expectedManifest = {
	name: siteConfig.siteName,
	short_name: siteConfig.webManifest.shortName,
	start_url: siteConfig.webManifest.startUrl,
	scope: siteConfig.webManifest.scope,
	icons: siteConfig.webManifest.icons.map((icon) => ({
		src: icon.src,
		sizes: `${icon.width}x${icon.height}`,
		type: icon.type,
		purpose: icon.purpose,
	})),
	theme_color: siteConfig.themeColor,
	background_color: siteConfig.themeColor,
	display: siteConfig.webManifest.display,
};
expect(
	manifest !== null && isDeepStrictEqual(manifest, expectedManifest),
	`public/${manifestName} must exactly match siteConfig webManifest and theme metadata`,
);

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const validatePng = async (asset) => {
	const name = publicName(asset.src);
	const data = await readPublicFile(name);
	if (data === null) return;

	const hasPngHeader = data.length >= 24
		&& data.subarray(0, pngSignature.length).equals(pngSignature)
		&& data.toString('ascii', 12, 16) === 'IHDR';
	expect(hasPngHeader, `public/${name} must be a valid PNG with an IHDR header`);
	if (!hasPngHeader) return;

	const width = data.readUInt32BE(16);
	const height = data.readUInt32BE(20);
	expect(
		asset.type === 'image/png',
		`${asset.src} must declare image/png in src/config/site.js`,
	);
	expect(
		width === asset.width && height === asset.height,
		`public/${name} is ${width}x${height}; expected ${asset.width}x${asset.height} from src/config/site.js`,
	);
};

const validateSvg = async (asset) => {
	const name = publicName(asset.src);
	const source = await readPublicFile(name, 'utf8');
	if (source === null) return;

	const viewBox = source.match(
		/viewBox\s*=\s*["']\s*[-+\d.eE]+\s+[-+\d.eE]+\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s*["']/i,
	);
	const width = Number.parseFloat(viewBox?.[1] ?? 'NaN');
	const height = Number.parseFloat(viewBox?.[2] ?? 'NaN');
	expect(source.includes('<svg'), `public/${name} must contain an SVG root element`);
	expect(
		asset.type === 'image/svg+xml',
		`${asset.src} must declare image/svg+xml in src/config/site.js`,
	);
	expect(
		width === asset.width && height === asset.height,
		`public/${name} has a ${width}x${height} viewBox; expected ${asset.width}x${asset.height} from src/config/site.js`,
	);
	expect(
		source.toLowerCase().includes(siteConfig.themeColor.toLowerCase()),
		`public/${name} must contain the configured theme color ${siteConfig.themeColor}`,
	);
};

const validateIco = async (asset) => {
	const name = publicName(asset.src);
	const data = await readPublicFile(name);
	if (data === null) return;

	const hasHeader = data.length >= 6
		&& data.readUInt16LE(0) === 0
		&& data.readUInt16LE(2) === 1;
	expect(hasHeader, `public/${name} must contain a valid ICO header`);
	if (!hasHeader) return;

	const entryCount = data.readUInt16LE(4);
	const actualSizes = [];
	for (let index = 0; index < entryCount; index += 1) {
		const offset = 6 + (index * 16);
		if (offset + 16 > data.length) {
			failures.push(`public/${name} has a truncated directory entry at index ${index}`);
			break;
		}

		const width = data[offset] || 256;
		const height = data[offset + 1] || 256;
		const byteLength = data.readUInt32LE(offset + 8);
		const imageOffset = data.readUInt32LE(offset + 12);
		actualSizes.push(`${width}x${height}`);
		expect(
			byteLength > 0 && imageOffset + byteLength <= data.length,
			`public/${name} has an invalid image payload for its ${width}x${height} entry`,
		);
	}

	const expectedSizes = asset.sizes.map(({ width, height }) => `${width}x${height}`);
	expect(
		asset.type === 'image/x-icon',
		`${asset.src} must declare image/x-icon in src/config/site.js`,
	);
	expect(
		isDeepStrictEqual(actualSizes.sort(), expectedSizes.sort()),
		`public/${name} contains [${actualSizes.join(', ')}]; expected [${expectedSizes.join(', ')}] from src/config/site.js`,
	);
};

const pngAssets = [
	siteConfig.socialImage,
	siteConfig.appleTouchIcon,
	...siteConfig.additionalIcons,
	...siteConfig.webManifest.icons,
];
const uniquePngAssets = new Map();
pngAssets.forEach((asset) => {
	const existing = uniquePngAssets.get(asset.src);
	expect(
		!existing || (
			existing.type === asset.type
			&& existing.width === asset.width
			&& existing.height === asset.height
		),
		`${asset.src} has conflicting metadata in src/config/site.js`,
	);
	uniquePngAssets.set(asset.src, asset);
});

await Promise.all([
	...uniquePngAssets.values().map(validatePng),
	validateSvg(siteConfig.favicon),
	validateIco(siteConfig.faviconIco),
]);

[
	['Portfolio home', homeUrl],
	[`About ${siteConfig.authorName}`, `${siteUrl}/#about`],
	['Featured projects', `${siteUrl}/#projects`],
	[`Contact ${siteConfig.authorName}`, `${siteUrl}/#contact`],
].forEach(([label, url]) => {
	expectText(llms ?? '', `[${label}](${url})`, 'public/llms.txt', `${label} URL`);
});

expectText(llms ?? '', `# ${siteConfig.siteName}`, 'public/llms.txt', 'the configured site name');
expectText(llms ?? '', siteConfig.authorName, 'public/llms.txt', 'the configured author name');
expectText(llms ?? '', `mailto:${siteConfig.contactEmail}`, 'public/llms.txt', 'the configured contact email');
expectText(llms ?? '', siteConfig.githubUrl, 'public/llms.txt', 'the configured GitHub URL');
expectText(llms ?? '', siteConfig.linkedinUrl, 'public/llms.txt', 'the configured LinkedIn URL');

projects.forEach((project) => {
	[
		['role', project.role],
		['challenge', project.challenge],
		['outcome', project.outcome],
	].forEach(([field, value]) => {
		expect(
			typeof value === 'string' && value.trim().length > 0,
			`${project.title} is missing a ${field} value in src/config/projects.js`,
		);
	});

	// Each project is intentionally a single llms.txt line, which lets this check bind
	// its description, impact details, technologies, and links to the correct title.
	const projectLine = (llms ?? '')
		.split(/\r?\n/)
		.find((line) => line.includes(project.title));
	expect(Boolean(projectLine), `public/llms.txt is missing the ${project.title} project entry`);
	if (!projectLine) return;

	expectText(projectLine, project.description, 'public/llms.txt', `the ${project.title} description`);
	expectText(projectLine, `Role: ${project.role}`, 'public/llms.txt', `the ${project.title} role`);
	expectText(projectLine, `Challenge: ${project.challenge}`, 'public/llms.txt', `the ${project.title} challenge`);
	expectText(projectLine, `Outcome: ${project.outcome}`, 'public/llms.txt', `the ${project.title} outcome`);

	project.technologies.forEach((technology) => {
		expectText(
			projectLine,
			technology,
			'public/llms.txt',
			`${project.title} technology “${technology}”`,
		);
	});

	if (project.liveUrl) {
		expectText(projectLine, project.liveUrl, 'public/llms.txt', `the ${project.title} live URL`);
	}

	if (project.source?.url && !project.source.private) {
		expectText(projectLine, project.source.url, 'public/llms.txt', `the ${project.title} public source URL`);
	}
});

if (failures.length > 0) {
	console.error('Public metadata alignment check failed:\n');
	failures.forEach((failure) => console.error(`- ${failure}`));
	process.exitCode = 1;
} else {
	console.log('Public metadata, headers, manifest, and image assets match the site configuration.');
}
