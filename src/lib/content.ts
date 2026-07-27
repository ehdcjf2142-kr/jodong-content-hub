import { getCollection } from 'astro:content';
import type { FeedItem } from './types';

export async function getAllFeedItems(): Promise<FeedItem[]> {
	const [videoEntries, blogEntries] = await Promise.all([
		getCollection('videos'),
		getCollection('blogLinks'),
	]);

	const videos: FeedItem[] = videoEntries.map((e) => ({
		id: `video:${e.id}`,
		kind: 'youtube',
		title: e.data.title,
		url: e.data.url,
		publishedAt: e.data.publishedAt,
		tags: e.data.tags,
		thumbnailUrl: e.data.thumbnailUrl,
		category: e.data.category,
	}));

	const blogs: FeedItem[] = blogEntries.map((e) => ({
		id: `blog:${e.id}`,
		kind: 'blog',
		title: e.data.title,
		url: e.data.url,
		publishedAt: e.data.publishedAt,
		tags: e.data.tags,
		platform: e.data.platform,
		summary: e.data.summary,
	}));

	return [...videos, ...blogs].sort(
		(a, b) => b.publishedAt.getTime() - a.publishedAt.getTime(),
	);
}

export function takeLatest(items: FeedItem[], n: number): FeedItem[] {
	return items.slice(0, n);
}
