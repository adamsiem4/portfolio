import { Buffer } from 'node:buffer';
import { siteConfig } from '../src/config/site.js';

const productionUrl = new URL('/', siteConfig.siteUrl).toString();
const failures = [];
const results = [];

const assert = (condition, message) => {
	if (!condition) throw new Error(message);
};

const runCheck = async (label, check) => {
	try {
		results.push(`${label}: ${await check()}`);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		failures.push(`${label}: ${reason}`);
	}
};

const request = async (url, init = {}) => {
	const headers = new Headers({
		Accept: '*/*',
		'Cache-Control': 'no-cache',
		'User-Agent': 'portfolio-production-metadata-validator/1.0',
	});
	new Headers(init.headers).forEach((value, name) => headers.set(name, value));

	return fetch(url, {
		...init,
		headers,
		redirect: 'follow',
		signal: AbortSignal.timeout(30_000),
	});
};

const decodeHtml = (value) => value
	.replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
	.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
	.replace(/&(amp|quot|apos|lt|gt);/g, (_, entity) => ({
		amp: '&',
		quot: '"',
		apos: "'",
		lt: '<',
		gt: '>',
	})[entity]);

const parseAttributes = (tag) => {
	const attributes = new Map();
	const body = tag
		.replace(/^<[^\s>]+\s*/i, '')
		.replace(/\/?>$/i, '');
	const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

	for (const match of body.matchAll(pattern)) {
		attributes.set(
			match[1].toLowerCase(),
			decodeHtml(match[2] ?? match[3] ?? match[4] ?? ''),
		);
	}

	return attributes;
};

const getHead = (html) => {
	const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1];
	assert(head, 'response does not contain a complete head element');
	return head;
};

const getMetadata = (html) => {
	const metadata = new Map();

	for (const tag of getHead(html).match(/<meta\b[^>]*>/gi) ?? []) {
		const attributes = parseAttributes(tag);
		const key = attributes.get('property') ?? attributes.get('name');
		if (!key) continue;
		const values = metadata.get(key) ?? [];
		values.push(attributes.get('content') ?? '');
		metadata.set(key, values);
	}

	return metadata;
};

const expectMetadata = (metadata, expected) => {
	for (const [name, expectedValue] of Object.entries(expected)) {
		const values = metadata.get(name) ?? [];
		assert(
			values.length === 1 && values[0] === expectedValue,
			`${name} is [${values.join(', ')}]; expected exactly ${expectedValue}`,
		);
	}
};

let productionHtml = '';
let productionMetadata = new Map();

await runCheck('Production page', async () => {
	const response = await request(productionUrl, {
		headers: { 'User-Agent': 'Googlebot/2.1 (+https://www.google.com/bot.html)' },
	});
	assert(response.status === 200, `returned HTTP ${response.status}`);
	assert(response.headers.get('content-type')?.includes('text/html'), 'did not return HTML');
	assert(
		response.headers.get('x-robots-tag') === siteConfig.robots,
		`X-Robots-Tag does not match siteConfig: ${response.headers.get('x-robots-tag')}`,
	);
	productionHtml = await response.text();
	productionMetadata = getMetadata(productionHtml);
	return 'HTTP 200 HTML is available to Googlebot with the configured robots directive';
});

const socialImageUrl = new URL(siteConfig.socialImage.src, productionUrl).toString();
const expectedSocialMetadata = {
	'og:type': 'website',
	'og:site_name': siteConfig.siteName,
	'og:title': siteConfig.socialTitle,
	'og:description': siteConfig.socialDescription,
	'og:url': productionUrl,
	'og:locale': siteConfig.locale,
	'og:image': socialImageUrl,
	'og:image:type': siteConfig.socialImage.type,
	'og:image:width': String(siteConfig.socialImage.width),
	'og:image:height': String(siteConfig.socialImage.height),
	'og:image:alt': siteConfig.socialImage.alt,
	'twitter:card': 'summary_large_image',
	'twitter:title': siteConfig.socialTitle,
	'twitter:description': siteConfig.socialDescription,
	'twitter:image': socialImageUrl,
	'twitter:image:alt': siteConfig.socialImage.alt,
};

await runCheck('Rendered social metadata', async () => {
	expectMetadata(productionMetadata, {
		robots: siteConfig.robots,
		...expectedSocialMetadata,
	});
	return 'Open Graph and Twitter/X fields are complete, unique, absolute, and config-aligned';
});

await runCheck('Rendered JSON-LD', async () => {
	const scripts = [...getHead(productionHtml).matchAll(
		/<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
	)];
	const documents = scripts
		.filter(([, attributes]) => parseAttributes(`<script ${attributes}>`).get('type') === 'application/ld+json')
		.map(([, , source]) => JSON.parse(source));
	assert(documents.length === 1, `found ${documents.length} JSON-LD documents; expected 1`);

	const graph = documents[0]?.['@graph'];
	assert(documents[0]?.['@context'] === 'https://schema.org', 'uses an unexpected @context');
	assert(Array.isArray(graph), 'does not contain an @graph array');
	const website = graph.find((node) => node['@type'] === 'WebSite');
	const person = graph.find((node) => node['@type'] === 'Person');
	assert(website?.name === siteConfig.siteName, 'WebSite name does not match siteConfig');
	assert(website?.url === siteConfig.siteUrl, 'WebSite URL does not match siteConfig');
	assert(website?.inLanguage === siteConfig.language, 'WebSite language does not match siteConfig');
	assert(person?.name === siteConfig.authorName, 'Person name does not match siteConfig');
	assert(person?.email === siteConfig.contactEmail, 'Person email does not match siteConfig');
	assert(
		JSON.stringify(person?.sameAs) === JSON.stringify([
			siteConfig.githubUrl,
			siteConfig.linkedinUrl,
		]),
		'Person sameAs profiles do not match siteConfig',
	);
	return 'WebSite and Person entities match the deployed site configuration';
});

await runCheck('Schema.org validator', async () => {
	const response = await request('https://validator.schema.org/validate', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ url: productionUrl }),
	});
	assert(response.status === 200, `returned HTTP ${response.status}`);
	// The public endpoint prefixes JSON with an XSSI guard before the response object.
	const report = JSON.parse((await response.text()).replace(/^\)\]\}'\s*/, ''));
	assert(report.url === productionUrl, `validated ${report.url ?? 'an unknown URL'}`);
	assert(report.totalNumErrors === 0, `reported ${report.totalNumErrors} errors`);
	assert(report.totalNumWarnings === 0, `reported ${report.totalNumWarnings} warnings`);
	const types = report.tripleGroups?.map((group) => group.type).sort() ?? [];
	assert(
		JSON.stringify(types) === JSON.stringify(['Person', 'WebSite']),
		`extracted [${types.join(', ')}]; expected Person and WebSite`,
	);
	return 'official URL fetch reports 2 objects, 0 errors, and 0 warnings';
});

await runCheck('Independent social-card crawler', async () => {
	const endpoint = new URL('/api/fetch-meta', 'https://og-image-previewer.pages.dev');
	endpoint.searchParams.set('url', productionUrl);
	const response = await request(endpoint);
	assert(response.status === 200, `returned HTTP ${response.status}`);
	const report = await response.json();
	assert(report.url === productionUrl, `crawled ${report.url ?? 'an unknown URL'}`);
	expectMetadata(
		new Map(Object.entries(report.meta ?? {}).map(([name, value]) => [name, [String(value)]])),
		expectedSocialMetadata,
	);
	return 'server-side crawler extracted every expected Open Graph and Twitter/X field';
});

await runCheck('Social image', async () => {
	const response = await request(socialImageUrl);
	assert(response.status === 200, `returned HTTP ${response.status}`);
	assert(
		response.headers.get('content-type')?.startsWith(siteConfig.socialImage.type),
		`returned ${response.headers.get('content-type') ?? 'no content type'}`,
	);
	const data = Buffer.from(await response.arrayBuffer());
	const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	assert(data.length >= 24 && data.subarray(0, 8).equals(pngSignature), 'is not a valid PNG');
	const width = data.readUInt32BE(16);
	const height = data.readUInt32BE(20);
	assert(
		width === siteConfig.socialImage.width && height === siteConfig.socialImage.height,
		`is ${width}x${height}; expected ${siteConfig.socialImage.width}x${siteConfig.socialImage.height}`,
	);
	assert(data.length < 5 * 1024 * 1024, `is ${(data.length / 1024 / 1024).toFixed(2)} MiB`);
	return `${width}x${height} PNG is publicly fetchable (${(data.length / 1024).toFixed(1)} KiB)`;
});

await runCheck('Sitemap', async () => {
	const sitemapUrl = new URL('/sitemap.xml', productionUrl).toString();
	const response = await request(sitemapUrl, {
		headers: { 'User-Agent': 'Googlebot/2.1 (+https://www.google.com/bot.html)' },
	});
	assert(response.status === 200, `returned HTTP ${response.status}`);
	assert(response.headers.get('content-type')?.includes('xml'), 'did not return an XML content type');
	const source = await response.text();
	assert(/^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\?>/.test(source), 'has no UTF-8 XML declaration');
	assert(
		source.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
		'does not use the sitemap protocol namespace',
	);
	const locations = [...source.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
	assert(
		locations.length === 1 && locations[0] === productionUrl,
		`contains [${locations.join(', ')}]; expected only ${productionUrl}`,
	);
	return `HTTP 200 XML contains the canonical production URL`;
});

await runCheck('Robots directives', async () => {
	const robotsUrl = new URL('/robots.txt', productionUrl).toString();
	const sitemapUrl = new URL('/sitemap.xml', productionUrl).toString();
	const response = await request(robotsUrl, {
		headers: { 'User-Agent': 'Googlebot/2.1 (+https://www.google.com/bot.html)' },
	});
	assert(response.status === 200, `returned HTTP ${response.status}`);
	assert(response.headers.get('content-type')?.startsWith('text/plain'), 'did not return text/plain');
	const source = await response.text();
	assert(/User-agent:\s*\*/i.test(source), 'does not define the wildcard crawler group');
	assert(/^Allow:\s*\/$/im.test(source), 'does not allow crawling from the site root');
	const sitemaps = source
		.split(/\r?\n/)
		.filter((line) => /^Sitemap:/i.test(line))
		.map((line) => line.replace(/^Sitemap:\s*/i, '').trim());
	assert(
		sitemaps.length === 1 && sitemaps[0] === sitemapUrl,
		`advertises [${sitemaps.join(', ')}]; expected only ${sitemapUrl}`,
	);
	return 'Googlebot can fetch the file, root crawling is allowed, and the sitemap is advertised';
});

await runCheck('Production 404 robots directive', async () => {
	const missingUrl = new URL('/__production-metadata-validator-not-found__', productionUrl);
	const response = await request(missingUrl);
	assert(response.status === 404, `returned HTTP ${response.status}`);
	const metadata = getMetadata(await response.text());
	expectMetadata(metadata, { robots: siteConfig.notFoundRobots });
	return `unknown URLs return HTTP 404 with ${siteConfig.notFoundRobots}`;
});

if (failures.length > 0) {
	console.error('Production metadata validation failed:\n');
	failures.forEach((failure) => console.error(`- ${failure}`));
	process.exitCode = 1;
} else {
	console.log('Production metadata validation passed:\n');
	results.forEach((result) => console.log(`- ${result}`));
}
