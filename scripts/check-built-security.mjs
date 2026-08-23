import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { siteConfig } from '../src/config/site.js';

const projectDirectory = new URL('../', import.meta.url);
const distDirectory = new URL('../dist/', import.meta.url);
const siteConfigFile = new URL('../src/config/site.js', import.meta.url);
const headersFile = new URL('../public/_headers', import.meta.url);
const hashTokenPattern = /\s+'sha256-[A-Za-z0-9+/]+={0,2}'/g;

export const synchronizeCspSources = ({
	siteSource,
	headersSource,
	contentSecurityPolicy,
	hashes,
}) => {
	const arrayStart = 'const inlineScriptHashes = [';
	const startIndex = siteSource.indexOf(arrayStart);
	const endMatch = startIndex === -1 ? null : siteSource.slice(startIndex).match(/\r?\n];/);
	const endIndex = endMatch ? startIndex + endMatch.index : -1;
	const newline = endMatch?.[0].startsWith('\r\n') ? '\r\n' : '\n';

	if (startIndex === -1 || endIndex === -1 || siteSource.indexOf(arrayStart, startIndex + 1) !== -1) {
		throw new Error('src/config/site.js must contain exactly one literal inlineScriptHashes array');
	}

	const arrayEndIndex = endIndex + newline.length + 2;
	const currentArray = siteSource.slice(startIndex, arrayEndIndex);
	if (!/^const inlineScriptHashes = \[(?:\r?\n\t'[A-Za-z0-9+/]+={0,2}',)*\r?\n];$/.test(currentArray)) {
		throw new Error('src/config/site.js must contain exactly one literal inlineScriptHashes array');
	}

	const scriptSourceMatch = contentSecurityPolicy.match(/(?:^|;\s*)script-src\s+([^;]+)/);
	if (!scriptSourceMatch) throw new Error('Content-Security-Policy must contain script-src');

	const scriptSource = scriptSourceMatch[1];
	const hashSources = hashes.map((hash) => `'sha256-${hash}'`).join(' ');
	const updatedScriptSource = [scriptSource.replace(hashTokenPattern, ''), hashSources]
		.filter(Boolean)
		.join(' ');
	const updatedPolicy = contentSecurityPolicy.replace(
		scriptSourceMatch[0],
		scriptSourceMatch[0].replace(scriptSource, updatedScriptSource),
	);
	const currentHeader = `Content-Security-Policy: ${contentSecurityPolicy}`;

	if (headersSource.split(currentHeader).length !== 2) {
		throw new Error('public/_headers must contain exactly the configured Content-Security-Policy');
	}

	const hashLines = hashes.map((hash) => `\t'${hash}',`).join(newline);
	const updatedArray = `${arrayStart}${newline}${hashLines}${hashLines ? newline : ''}];`;

	return {
		siteSource: `${siteSource.slice(0, startIndex)}${updatedArray}${siteSource.slice(arrayEndIndex)}`,
		headersSource: headersSource.replace(
			currentHeader,
			`Content-Security-Policy: ${updatedPolicy}`,
		),
		contentSecurityPolicy: updatedPolicy,
	};
};

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

const runValidation = (script) => {
	const result = spawnSync(process.execPath, ['run', script], {
		cwd: projectDirectory,
		stdio: 'inherit',
	});

	if (result.error) throw result.error;
	if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}`);
};

const run = async () => {
	const arguments_ = process.argv.slice(2);
	const writeMode = arguments_.includes('--write');
	const unexpectedArguments = arguments_.filter((argument) => argument !== '--write');
	if (unexpectedArguments.length > 0) {
		throw new Error(`Unknown argument: ${unexpectedArguments.join(', ')}`);
	}

	const failures = [];
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

			if (!writeMode && !configuredHashes.has(hash)) {
				failures.push(
					`${relativeName} inline script ${index + 1} is not authorized by CSP; add 'sha256-${hash}'`,
				);
			}
		});
	}

	if (!writeMode) {
		configuredHashes.forEach((hash) => {
			if (!generatedHashes.has(hash)) {
				failures.push(`CSP contains a stale inline-script hash: 'sha256-${hash}'`);
			}
		});
	}

	if (htmlFiles.length === 0) failures.push('dist does not contain any generated HTML files');

	if (failures.length > 0) {
		console.error('Built Content Security Policy check failed:\n');
		failures.forEach((failure) => console.error(`- ${failure}`));
		process.exitCode = 1;
		return;
	}

	if (writeMode) {
		const hashes = [
			...[...configuredHashes].filter((hash) => generatedHashes.has(hash)),
			...[...generatedHashes.keys()]
				.filter((hash) => !configuredHashes.has(hash))
				.sort(),
		];
		const [siteSource, headersSource] = await Promise.all([
			readFile(siteConfigFile, 'utf8'),
			readFile(headersFile, 'utf8'),
		]);
		const synchronized = synchronizeCspSources({
			siteSource,
			headersSource,
			contentSecurityPolicy,
			hashes,
		});

		await Promise.all([
			writeFile(siteConfigFile, synchronized.siteSource),
			writeFile(headersFile, synchronized.headersSource),
		]);

		console.log(`Synchronized ${hashes.length} inline-script CSP hashes.`);
		runValidation('check:public');
		runValidation('check:built-security');
		return;
	}

	console.log(
		`Content Security Policy authorizes ${generatedHashes.size} unique inline scripts across ${htmlFiles.length} HTML files.`,
	);
};

if (import.meta.main) {
	try {
		await run();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
