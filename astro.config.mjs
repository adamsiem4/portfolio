// @ts-check
import { defineConfig } from 'astro/config';
import { siteConfig } from './src/config/site.js';

// https://astro.build/config
export default defineConfig({
	site: siteConfig.siteUrl,
	devToolbar: {
		enabled: false,
	},
	build: {
		inlineStylesheets: 'always',
	},
});
