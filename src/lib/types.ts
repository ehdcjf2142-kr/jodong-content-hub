export type FeedKind = 'youtube' | 'blog';

export interface FeedItem {
	id: string;
	kind: FeedKind;
	title: string;
	url: string;
	publishedAt: Date;
	tags: string[];
	thumbnailUrl?: string;
	category?: 'game-analysis' | 'mobile-review' | 'visual-poem';
	platform?: 'tistory' | 'naver';
	summary?: string;
}

export type SearchIndexRow = Pick<
	FeedItem,
	'id' | 'kind' | 'title' | 'url' | 'tags' | 'thumbnailUrl' | 'category' | 'platform' | 'summary'
> & { publishedAt: string };
