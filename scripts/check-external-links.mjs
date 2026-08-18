import { readdir } from 'node:fs/promises';
import { projects } from '../src/config/projects.js';
import { siteConfig } from '../src/config/site.js';

const categoryOrder = [
	'Live projects',
	'Public repositories',
	'Social profiles',
	'Credentials',
	'Privacy policy',
];
const requiredCategories = categoryOrder.filter((category) => category !== 'Credentials');
const targets = new Map();
const configurationFailures = [];

const addTarget = (category, label, value) => {
	if (typeof value !== 'string' || value.trim() === '') {
		configurationFailures.push(`${category} · ${label} does not define a URL`);
		return;
	}

	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		configurationFailures.push(`${category} · ${label} is not a valid URL: ${value}`);
		return;
	}

	if (parsed.protocol !== 'https:') {
		configurationFailures.push(`${category} · ${label} must use HTTPS: ${value}`);
		return;
	}

	parsed.hash = '';
	const url = parsed.toString();
	const target = targets.get(url) ?? { url, references: [] };
	if (!target.references.some((reference) => reference.category === category && reference.label === label)) {
		target.references.push({ category, label });
	}
	targets.set(url, target);
};

projects.forEach((project) => {
	if (project.liveUrl) addTarget('Live projects', project.title, project.liveUrl);
	if (project.source?.url && project.source.private !== true) {
		addTarget('Public repositories', project.title, project.source.url);
	}
});

addTarget('Social profiles', 'GitHub', siteConfig.githubUrl);
addTarget('Social profiles', 'LinkedIn', siteConfig.linkedinUrl);
addTarget('Privacy policy', 'Cloudflare', siteConfig.privacyNotice.providerUrl);

// Certification records do not exist yet. Discover `credentialUrl` fields from
// every JavaScript config module so future structured records are monitored
// without copying their URLs into this script.
const configDirectory = new URL('../src/config/', import.meta.url);
const configFiles = (await readdir(configDirectory))
	.filter((name) => name.endsWith('.js'))
	.sort();

const collectCredentialUrls = (value, path, seen = new WeakSet()) => {
	if (!value || typeof value !== 'object' || seen.has(value)) return;
	seen.add(value);

	const recordLabel = [value.title, value.name, value.label]
		.find((candidate) => typeof candidate === 'string' && candidate.trim() !== '');

	Object.entries(value).forEach(([key, nestedValue]) => {
		const nestedPath = `${path}.${key}`;
		if (/^credentialUrls?$/i.test(key)) {
			const values = Array.isArray(nestedValue) ? nestedValue : [nestedValue];
			values.forEach((url, index) => {
				const suffix = values.length > 1 ? ` ${index + 1}` : '';
				addTarget('Credentials', `${recordLabel ?? nestedPath}${suffix}`, url);
			});
			return;
		}

		collectCredentialUrls(nestedValue, nestedPath, seen);
	});
};

for (const configFile of configFiles) {
	const configModule = await import(new URL(configFile, configDirectory));
	Object.entries(configModule).forEach(([exportName, value]) => {
		collectCredentialUrls(value, `${configFile}:${exportName}`);
	});
}

const categoryCount = (category) => [...targets.values()]
	.filter((target) => target.references.some((reference) => reference.category === category))
	.length;

requiredCategories.forEach((category) => {
	if (categoryCount(category) === 0) {
		configurationFailures.push(`${category} has no configured URLs`);
	}
});

if (configurationFailures.length > 0) {
	console.error('External link configuration is invalid:');
	configurationFailures.forEach((failure) => console.error(`- ${failure}`));
	process.exitCode = 1;
} else {
	const requestTimeoutMs = 20_000;
	const maximumAttempts = 3;
	const maximumConcurrency = 3;
	const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
	const isBotBlock = (target, status) => {
		if (status === 429 || status === 999) return true;
		const hostname = new URL(target.url).hostname.replace(/^www\./, '');
		return hostname === 'linkedin.com' && (status === 401 || status === 403);
	};
	const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
	const requestHeaders = {
		Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
		'Cache-Control': 'no-cache',
		'User-Agent': `Mozilla/5.0 (compatible; PortfolioLinkHealth/1.0; +${siteConfig.siteUrl}/)`,
	};

	const closeResponse = async (response) => {
		try {
			await response.body?.cancel();
		} catch {
			// Headers are sufficient for this check; ignore body cancellation races.
		}
	};

	const checkTarget = async (target) => {
		let lastFailure = 'request failed';

		for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
			try {
				const response = await fetch(target.url, {
					method: 'GET',
					redirect: 'follow',
					headers: requestHeaders,
					signal: AbortSignal.timeout(requestTimeoutMs),
				});
				const finalUrl = response.url || target.url;
				const status = response.status;
				await closeResponse(response);

				if (status >= 200 && status < 300) {
					return { outcome: 'healthy', status, finalUrl, attempt };
				}

				lastFailure = `HTTP ${status}`;
				if (isBotBlock(target, status)) {
					if (status === 429 && attempt < maximumAttempts) {
						await delay(750 * (2 ** (attempt - 1)));
						continue;
					}

					return {
						outcome: 'unverified',
						status,
						finalUrl,
						attempt,
						reason: 'the server blocks or rate-limits automated requests',
					};
				}

				if (!retryableStatuses.has(status) && status < 500) {
					return { outcome: 'failed', status, finalUrl, attempt, reason: lastFailure };
				}
			} catch (error) {
				lastFailure = error instanceof Error ? error.message : String(error);
			}

			if (attempt < maximumAttempts) {
				await delay(750 * (2 ** (attempt - 1)));
			}
		}

		return {
			outcome: 'failed',
			attempt: maximumAttempts,
			reason: `${lastFailure} after ${maximumAttempts} attempts`,
		};
	};

	const targetList = [...targets.values()];
	const results = new Array(targetList.length);
	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < targetList.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await checkTarget(targetList[index]);
		}
	};

	console.log(`Checking ${targetList.length} unique external links:`);
	categoryOrder.forEach((category) => {
		const count = categoryCount(category);
		const suffix = category === 'Credentials' && count === 0 ? ' (none configured yet)' : '';
		console.log(`- ${category}: ${count}${suffix}`);
	});

	await Promise.all(
		Array.from({ length: Math.min(maximumConcurrency, targetList.length) }, () => worker()),
	);

	const describeReferences = (target) => target.references
		.map(({ category, label }) => `${category} · ${label}`)
		.join(', ');
	const escapeWorkflowCommand = (value) => String(value)
		.replaceAll('%', '%25')
		.replaceAll('\r', '%0D')
		.replaceAll('\n', '%0A');
	const annotate = (level, title, message) => {
		if (process.env.GITHUB_ACTIONS === 'true') {
			console.log(`::${level} title=${escapeWorkflowCommand(title)}::${escapeWorkflowCommand(message)}`);
		}
	};

	let healthyCount = 0;
	let unverifiedCount = 0;
	let failedCount = 0;

	targetList.forEach((target, index) => {
		const result = results[index];
		const label = describeReferences(target);
		const redirected = result.finalUrl && result.finalUrl !== target.url
			? ` → ${result.finalUrl}`
			: '';

		if (result.outcome === 'healthy') {
			healthyCount += 1;
			console.log(`✓ ${label}: HTTP ${result.status}${redirected}`);
			return;
		}

		if (result.outcome === 'unverified') {
			unverifiedCount += 1;
			const message = `HTTP ${result.status}; ${result.reason}${redirected}`;
			console.log(`! ${label}: ${message}`);
			annotate('warning', label, `${target.url} — ${message}`);
			return;
		}

		failedCount += 1;
		const message = `${result.reason}${redirected}`;
		console.error(`✗ ${label}: ${message}`);
		annotate('error', label, `${target.url} — ${message}`);
	});

	if (failedCount > 0) {
		console.error(`External link health check failed: ${failedCount} failed, ${healthyCount} healthy, ${unverifiedCount} unverified.`);
		process.exitCode = 1;
	} else {
		console.log(`External link health check passed: ${healthyCount} healthy, ${unverifiedCount} unverified.`);
	}
}
