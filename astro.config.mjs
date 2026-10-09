// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

// Replace with your production URL after first Vercel deploy.
const site = process.env.PUBLIC_SITE_URL ?? 'https://jodong-content-hub.vercel.app';

// https://astro.build/config
export default defineConfig({
	site,
	output: 'static',
	adapter: vercel(),
	vite: {
		plugins: [tailwindcss()],
	},

	integrations: [react(), sitemap()],
});
