import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const videos = defineCollection({
	loader: glob({ pattern: '**/*.json', base: './src/content/videos' }),
	schema: z.object({
		title: z.string(),
		url: z.string().url(),
		thumbnailUrl: z.string().url().optional(),
		publishedAt: z.coerce.date(),
		tags: z.array(z.string()).default([]),
		category: z.enum(['game-analysis', 'mobile-review', 'visual-poem']),
	}),
});

const blogLinks = defineCollection({
	loader: glob({ pattern: '**/*.json', base: './src/content/blog-links' }),
	schema: z.object({
		title: z.string(),
		url: z.string().url(),
		publishedAt: z.coerce.date(),
		tags: z.array(z.string()).default([]),
		platform: z.enum(['tistory', 'naver']),
		summary: z.string().optional(),
	}),
});

export const collections = { videos, blogLinks };
