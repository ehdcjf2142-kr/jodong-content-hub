/**
 * Sync YouTube (Data API) + Tistory/Naver RSS into content JSON files.
 *
 * Env:
 *   YOUTUBE_API_KEY       — YouTube Data API (없으면 RSS fallback)
 *   YOUTUBE_CHANNEL_ID    — RSS fallback용 (자동 추출 시도)
 *   YOUTUBE_CHANNEL_HANDLE — default: JodongBroOfficial
 *   SYNC_MAX_VIDEOS       — default: 20
 *   SYNC_MAX_BLOG         — default: 10 (per platform)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const VIDEOS_DIR = path.join(ROOT, 'src/content/videos');
const BLOG_DIR = path.join(ROOT, 'src/content/blog-links');

const YOUTUBE_HANDLE = process.env.YOUTUBE_CHANNEL_HANDLE || 'JodongBroOfficial';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const MAX_VIDEOS = Number.parseInt(process.env.SYNC_MAX_VIDEOS || '20', 10);
const MAX_BLOG = Number.parseInt(process.env.SYNC_MAX_BLOG || '10', 10);

const TISTORY_RSS = 'https://jodongbro.tistory.com/rss';
const NAVER_RSS = 'https://rss.blog.naver.com/gamelifeequation.xml';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function slugify(input) {
	return input
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9가-힣]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60) || 'item';
}

function stripHtml(html) {
	if (!html) return '';
	return String(html)
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function categorizeVideo(title, description = '') {
	const text = `${title} ${description}`.toLowerCase();
	if (/쇼츠|시|poem|낭독|visual/.test(text)) return 'visual-poem';
	if (/모바일|mobile|찍먹|gacha|리듬|터치/.test(text)) return 'mobile-review';
	return 'game-analysis';
}

function extractTags(title, description = '') {
	const text = `${title} ${description}`;
	const tags = new Set();
	const rules = [
		[/쇼츠|shorts/i, '쇼츠'],
		[/시|poem/i, '시'],
		[/모바일|mobile/i, '모바일'],
		[/로그라이크|roguelike/i, '로그라이크'],
		[/분석|analysis|lore/i, '분석'],
		[/게임|game/i, '게임'],
	];
	for (const [re, tag] of rules) {
		if (re.test(text)) tags.add(tag);
	}
	return [...tags].slice(0, 5);
}

async function writeJson(dir, filename, data) {
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, filename), `${JSON.stringify(data, null, '\t')}\n`, 'utf8');
}

async function clearJsonDir(dir) {
	await fs.mkdir(dir, { recursive: true });
	const files = await fs.readdir(dir);
	await Promise.all(
		files.filter((f) => f.endsWith('.json')).map((f) => fs.unlink(path.join(dir, f))),
	);
}

async function fetchJson(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.json();
}

async function resolveYouTubeChannelId() {
	if (YOUTUBE_CHANNEL_ID) return YOUTUBE_CHANNEL_ID;

	const pageUrl = `https://www.youtube.com/@${YOUTUBE_HANDLE}`;
	const res = await fetch(pageUrl, {
		headers: { 'User-Agent': 'Mozilla/5.0 (compatible; jodong-content-hub/1.0)' },
	});
	if (!res.ok) throw new Error(`Cannot load YouTube channel page: ${pageUrl}`);

	const html = await res.text();
	const match =
		html.match(/"channelId":"(UC[\w-]{22})"/) ||
		html.match(/"externalId":"(UC[\w-]{22})"/) ||
		html.match(/channel_id=(UC[\w-]{22})/);

	if (!match) throw new Error('Could not resolve YouTube channel ID from handle page');
	return match[1];
}

async function syncYouTubeRss() {
	const channelId = await resolveYouTubeChannelId();
	const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
	const res = await fetch(feedUrl);
	if (!res.ok) throw new Error(`YouTube RSS fetch failed: ${feedUrl}`);

	const xml = await res.text();
	const parsed = xmlParser.parse(xml);
	const items = normalizeRssItems(parsed).slice(0, MAX_VIDEOS);

	await clearJsonDir(VIDEOS_DIR);

	let count = 0;
	for (const item of items) {
		const title = item.title?.['#text'] ?? item.title ?? 'Untitled';
		const link = item.link?.['@_href'] ?? item.link ?? '';
		const videoId = item['yt:videoId']?.['#text'] ?? item['yt:videoId'] ?? link.match(/v=([^&]+)/)?.[1];
		const publishedAt = item.published ?? item.pubDate ?? new Date().toISOString();
		const description = stripHtml(item['media:group']?.['media:description'] ?? item.description ?? '');

		if (!videoId) continue;

		const entry = {
			title: String(title).trim(),
			url: `https://www.youtube.com/watch?v=${videoId}`,
			thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
			publishedAt: new Date(publishedAt).toISOString(),
			tags: extractTags(String(title), description),
			category: categorizeVideo(String(title), description),
		};

		await writeJson(VIDEOS_DIR, `yt-${videoId}.json`, entry);
		count++;
	}

	console.log(`✓ YouTube (RSS fallback): ${count} videos synced`);
	return count;
}

async function syncYouTube() {
	if (!YOUTUBE_API_KEY) {
		console.warn('⚠ YOUTUBE_API_KEY not set — using YouTube RSS fallback');
		return syncYouTubeRss();
	}

	const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
	channelUrl.searchParams.set('part', 'contentDetails');
	channelUrl.searchParams.set('forHandle', YOUTUBE_HANDLE);
	channelUrl.searchParams.set('key', YOUTUBE_API_KEY);

	const channelData = await fetchJson(channelUrl);
	const channel = channelData.items?.[0];
	if (!channel) throw new Error(`YouTube channel not found for handle: ${YOUTUBE_HANDLE}`);

	const uploadsPlaylistId = channel.contentDetails.relatedPlaylists.uploads;

	const playlistUrl = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
	playlistUrl.searchParams.set('part', 'snippet');
	playlistUrl.searchParams.set('playlistId', uploadsPlaylistId);
	playlistUrl.searchParams.set('maxResults', String(MAX_VIDEOS));
	playlistUrl.searchParams.set('key', YOUTUBE_API_KEY);

	const playlistData = await fetchJson(playlistUrl);
	const playlistItems = playlistData.items ?? [];

	const videoIds = playlistItems
		.map((item) => item.snippet?.resourceId?.videoId)
		.filter(Boolean);

	if (videoIds.length === 0) {
		console.warn('⚠ No YouTube videos found');
		return 0;
	}

	const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
	videosUrl.searchParams.set('part', 'snippet');
	videosUrl.searchParams.set('id', videoIds.join(','));
	videosUrl.searchParams.set('key', YOUTUBE_API_KEY);

	const videosData = await fetchJson(videosUrl);
	const detailsById = new Map((videosData.items ?? []).map((v) => [v.id, v.snippet]));

	await clearJsonDir(VIDEOS_DIR);

	let count = 0;
	for (const id of videoIds) {
		const snippet = detailsById.get(id) ?? playlistItems.find((p) => p.snippet?.resourceId?.videoId === id)?.snippet;
		if (!snippet) continue;

		const title = snippet.title;
		const description = snippet.description ?? '';
		const publishedAt = snippet.publishedAt;
		const thumb =
			snippet.thumbnails?.maxres?.url ||
			snippet.thumbnails?.high?.url ||
			snippet.thumbnails?.medium?.url ||
			`https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

		const entry = {
			title,
			url: `https://www.youtube.com/watch?v=${id}`,
			thumbnailUrl: thumb,
			publishedAt,
			tags: extractTags(title, description),
			category: categorizeVideo(title, description),
		};

		await writeJson(VIDEOS_DIR, `yt-${id}.json`, entry);
		count++;
	}

	console.log(`✓ YouTube: ${count} videos synced`);
	return count;
}

function normalizeRssItems(parsed) {
	const channel = parsed.rss?.channel ?? parsed.feed;
	if (!channel) return [];

	const raw = channel.item ?? channel.entry ?? [];
	return Array.isArray(raw) ? raw : [raw];
}

async function syncRssFeed(feedUrl, platform) {
	const res = await fetch(feedUrl);
	if (!res.ok) throw new Error(`RSS fetch failed (${res.status}): ${feedUrl}`);

	const xml = await res.text();
	const parsed = xmlParser.parse(xml);
	const items = normalizeRssItems(parsed).slice(0, MAX_BLOG);

	const entries = [];
	for (const item of items) {
		const title = item.title?.['#text'] ?? item.title ?? 'Untitled';
		const link = item.link?.['@_href'] ?? item.link ?? item.guid?.['#text'] ?? item.guid;
		const pubDate = item.pubDate ?? item.published ?? item.updated;
		const description = stripHtml(item.description?.['#text'] ?? item.description ?? item.summary ?? '');

		if (!link) continue;

		const publishedAt = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();
		const urlStr = String(link).trim();
		const logNo = urlStr.match(/\/(\d{5,})(?:\?|$)/)?.[1];
		const tistoryId = urlStr.match(/tistory\.com\/(\d+)/)?.[1];
		const idPart = logNo || tistoryId || slugify(String(title));

		entries.push({
			filename: `${platform}-${idPart}.json`,
			data: {
				title: String(title).trim(),
				url: String(link).trim(),
				publishedAt,
				tags: extractTags(String(title), description),
				platform,
				...(description ? { summary: description.slice(0, 160) } : {}),
			},
		});
	}

	return entries;
}

async function syncBlogs() {
	const tistory = await syncRssFeed(TISTORY_RSS, 'tistory');
	const naver = await syncRssFeed(NAVER_RSS, 'naver');
	const all = [...tistory, ...naver];

	await clearJsonDir(BLOG_DIR);

	const used = new Set();
	for (const { filename, data } of all) {
		let name = filename;
		let i = 2;
		while (used.has(name)) {
			name = filename.replace('.json', `-${i}.json`);
			i++;
		}
		used.add(name);
		await writeJson(BLOG_DIR, name, data);
	}

	console.log(`✓ Blogs: ${all.length} posts synced (tistory ${tistory.length}, naver ${naver.length})`);
	return all.length;
}

async function main() {
	console.log('Syncing content…');
	const yt = await syncYouTube();
	const blogs = await syncBlogs();
	console.log(`Done. YouTube: ${yt}, Blogs: ${blogs}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
