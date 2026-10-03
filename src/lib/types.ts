export type FeedKind = 'youtube' | 'blog';

export interface FeedItem {
	id: string;
	kind: FeedKind;
	title: string;
	url: string;
	publishedAt: Date;
	tags: string[];
	thumbnailUrl?: string;
	platform?: 'tistory' | 'naver';
	summary?: string;
}

export type SearchIndexRow = Pick<
	FeedItem,
	'id' | 'kind' | 'title' | 'url' | 'tags' | 'thumbnailUrl' | 'platform' | 'summary'
> & { publishedAt: string };
