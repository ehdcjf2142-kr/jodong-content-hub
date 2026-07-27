import type { FeedItem, SearchIndexRow } from './types';

export function toSearchIndexRows(items: FeedItem[]): SearchIndexRow[] {
	return items.map((i) => ({
		id: i.id,
		kind: i.kind,
		title: i.title,
		url: i.url,
		tags: i.tags,
		thumbnailUrl: i.thumbnailUrl,
		category: i.category,
		platform: i.platform,
		summary: i.summary,
		publishedAt: i.publishedAt.toISOString(),
	}));
}
