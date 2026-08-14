import { readFile } from 'node:fs/promises';
import { projects } from '../src/config/projects.js';
import { siteConfig } from '../src/config/site.js';

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);
const [sitemap, robots, llms] = await Promise.all([
	readFile(publicFile('sitemap.xml'), 'utf8'),
	readFile(publicFile('robots.txt'), 'utf8'),
	readFile(publicFile('llms.txt'), 'utf8'),
]);

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

const siteUrl = siteConfig.siteUrl.replace(/\/$/, '');
const homeUrl = `${siteUrl}/`;
const sitemapUrl = `${siteUrl}/sitemap.xml`;
const sitemapLocations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)]
	.map((match) => match[1].trim());
const robotsSitemaps = robots
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

[
	['Portfolio home', homeUrl],
	['About Adam Salicki', `${siteUrl}/#about`],
	['Featured projects', `${siteUrl}/#projects`],
	['Contact Adam Salicki', `${siteUrl}/#contact`],
].forEach(([label, url]) => {
	expectText(llms, `[${label}](${url})`, 'public/llms.txt', `${label} URL`);
});

expectText(llms, siteConfig.authorName, 'public/llms.txt', 'the configured author name');
expectText(llms, `mailto:${siteConfig.contactEmail}`, 'public/llms.txt', 'the configured contact email');
expectText(llms, siteConfig.githubUrl, 'public/llms.txt', 'the configured GitHub URL');
expectText(llms, siteConfig.linkedinUrl, 'public/llms.txt', 'the configured LinkedIn URL');

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

	const projectLine = llms
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
	console.log('Public sitemap, robots, and llms files match the current site configuration.');
}
