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
	vite: {
		build: {
			// Inline the ASCII background module so its first still frame paints right
			// after parsing instead of waiting for a separate request (Speed Index).
			// Every other asset keeps Vite's default limit (undefined -> 4 KiB).
			assetsInlineLimit: (filePath) => (
				filePath.includes('CyberBackground.astro_astro_type_script') ? true : undefined
			),
		},
	},
});
