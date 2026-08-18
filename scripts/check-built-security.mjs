import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { siteConfig } from '../src/config/site.js';

const distDirectory = new URL('../dist/', import.meta.url);
const failures = [];

const collectHtmlFiles = async (directory) => {
	const files = [];
	const entries = await readdir(directory, { withFileTypes: true });

	for (const entry of entries) {
		const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
		if (entry.isDirectory()) files.push(...await collectHtmlFiles(url));
		else if (entry.isFile() && entry.name.endsWith('.html')) files.push(url);
	}

	return files;
};

const contentSecurityPolicy = siteConfig.responseHeaders['Content-Security-Policy'];
const scriptSource = contentSecurityPolicy
	.match(/(?:^|;\s*)script-src\s+([^;]+)/)?.[1] ?? '';
const configuredHashes = new Set(
	[...scriptSource.matchAll(/'sha256-([A-Za-z0-9+/]+={0,2})'/g)]
		.map((match) => match[1]),
);
const generatedHashes = new Map();

let htmlFiles = [];
try {
	htmlFiles = await collectHtmlFiles(distDirectory);
} catch (error) {
	const reason = error instanceof Error ? error.message : String(error);
	failures.push(`dist could not be inspected; run the Astro build first: ${reason}`);
}

for (const file of htmlFiles) {
	const html = await readFile(file, 'utf8');
	const relativeName = decodeURIComponent(file.pathname.split('/dist/').at(-1) ?? file.pathname);
	const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

	scripts.forEach(([, attributes, source], index) => {
		if (/\bsrc\s*=/i.test(attributes) || source.length === 0) return;

		const hash = createHash('sha256').update(source).digest('base64');
		const locations = generatedHashes.get(hash) ?? [];
		locations.push(`${relativeName} inline script ${index + 1}`);
		generatedHashes.set(hash, locations);

		if (!configuredHashes.has(hash)) {
			failures.push(
				`${relativeName} inline script ${index + 1} is not authorized by CSP; add 'sha256-${hash}'`,
			);
		}
	});
}

configuredHashes.forEach((hash) => {
	if (!generatedHashes.has(hash)) {
		failures.push(`CSP contains a stale inline-script hash: 'sha256-${hash}'`);
	}
});

if (htmlFiles.length === 0) {
	failures.push('dist does not contain any generated HTML files');
}

if (failures.length > 0) {
	console.error('Built Content Security Policy check failed:\n');
	failures.forEach((failure) => console.error(`- ${failure}`));
	process.exitCode = 1;
} else {
	console.log(
		`Content Security Policy authorizes ${generatedHashes.size} unique inline scripts across ${htmlFiles.length} HTML files.`,
	);
}
