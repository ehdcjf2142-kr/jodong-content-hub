/**
 * Sync YouTube (Data API) + Tistory/Naver RSS into content JSON files.
 * Existing archive files are kept. New items are added by URL identity.
 *
 * Env:
 *   YOUTUBE_API_KEY       — YouTube Data API (없으면 RSS fallback)
 *     GitHub Actions: Settings → Secrets and variables → Actions 에
 *     Name=YOUTUBE_API_KEY 시크릿을 만든 뒤, workflow env 에
 *     YOUTUBE_API_KEY: ${{ secrets.YOUTUBE_API_KEY }} 로 주입한다.
 *     (.github/workflows/sync-content.yml, auto-sync.yml)
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
export const VIDEOS_DIR = path.join(ROOT, 'src/content/videos');
export const BLOG_DIR = path.join(ROOT, 'src/content/blog-links');

const YOUTUBE_HANDLE = process.env.YOUTUBE_CHANNEL_HANDLE || 'JodongBroOfficial';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
const MAX_VIDEOS = Number.parseInt(process.env.SYNC_MAX_VIDEOS || '20', 10);
const MAX_BLOG = Number.parseInt(process.env.SYNC_MAX_BLOG || '10', 10);
/** Same-title live restarts from one broadcast setup, not a later scheduled stream. */
const DUPLICATE_LIVE_WINDOW_MS = 36 * 60 * 60 * 1000;

const UA = 'Mozilla/5.0 (compatible; jodong-content-hub/1.0)';
const BROWSER_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const YOUTUBE_RSS_ATTEMPTS = 3;
export const TISTORY_RSS = 'https://jodongbro.tistory.com/rss';
export const NAVER_RSS = 'https://rss.blog.naver.com/gamelifeequation.xml';

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

export function stripHtml(html) {
	if (!html) return '';
	return String(html)
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function uniqueTags(values) {
	const tags = [];
	const seen = new Set();
	for (const value of values) {
		const tag = String(value ?? '').replace(/\s+/g, ' ').trim();
		if (!tag || seen.has(tag)) continue;
		seen.add(tag);
		tags.push(tag);
	}
	return tags;
}

function rssText(value) {
	if (value == null) return '';
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	return String(value['#text'] ?? '');
}

export function blogTagsFromRssItem(item, platform) {
	if (platform === 'naver') return uniqueTags(rssText(item.tag).split(','));
	const category = item.category;
	const list = Array.isArray(category) ? category : category == null ? [] : [category];
	return uniqueTags(list.map((entry) => rssText(entry)));
}

let youtubeClientPromise;

function youtubeInnertubeClient() {
	if (!youtubeClientPromise) {
		youtubeClientPromise = (async () => {
			const res = await fetch(`https://www.youtube.com/@${YOUTUBE_HANDLE}/videos`, {
				headers: { 'User-Agent': UA },
			});
			if (!res.ok) throw new Error(`Cannot load YouTube channel page (${res.status})`);
			const html = await res.text();
			const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
			const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
			if (!key || !version) throw new Error('Could not read the YouTube client');
			return { key, version };
		})();
	}
	return youtubeClientPromise;
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** YouTube Data API duration, e.g. PT1H2M3S. null when missing or not a time. */
export function parseIso8601Duration(value) {
	if (typeof value !== 'string') return null;
	const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
	if (!match || (match[1] == null && match[2] == null && match[3] == null)) return null;
	return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function normalizeVideoTitle(title) {
	return String(title ?? '')
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, '');
}

const TITLE_RESTART_SUFFIX = /^(?:\d{1,2}|다시|재시작|재방|재업로드|라이브|live)+$/i;

/** Same live title, ignoring spacing/punctuation and a short restart suffix. */
export function videoTitlesSimilar(a, b) {
	const left = normalizeVideoTitle(a);
	const right = normalizeVideoTitle(b);
	if (!left || !right) return false;
	if (left === right) return true;
	const longer = left.length >= right.length ? left : right;
	const shorter = left.length >= right.length ? right : left;
	if (shorter.length < 8 || !longer.startsWith(shorter)) return false;
	const extra = longer.slice(shorter.length);
	return extra.length <= 6 && TITLE_RESTART_SUFFIX.test(extra);
}

function publishedTime(value) {
	const time = new Date(value).getTime();
	return Number.isFinite(time) ? time : null;
}

/**
 * Among playable videos, collapse same-title lives created back-to-back
 * and keep the longest recording.
 */
export function pickBroadcastVideos(videos, windowMs = DUPLICATE_LIVE_WINDOW_MS) {
	const sorted = [...videos].sort((a, b) => {
		const delta = (publishedTime(a.publishedAt) ?? 0) - (publishedTime(b.publishedAt) ?? 0);
		if (delta !== 0) return delta;
		return (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0);
	});

	const clusters = [];
	for (const video of sorted) {
		const publishedAt = publishedTime(video.publishedAt);
		let joined = false;
		if (publishedAt != null) {
			for (let i = clusters.length - 1; i >= 0; i--) {
				const cluster = clusters[i];
				const latestAt = publishedTime(cluster[cluster.length - 1].publishedAt);
				const firstAt = publishedTime(cluster[0].publishedAt);
				if (latestAt == null || firstAt == null) continue;
				if (
					publishedAt >= latestAt &&
					publishedAt - latestAt <= windowMs &&
					publishedAt - firstAt <= windowMs &&
					videoTitlesSimilar(cluster[cluster.length - 1].title, video.title)
				) {
					cluster.push(video);
					joined = true;
					break;
				}
			}
		}
		if (!joined) clusters.push([video]);
	}

	const keep = [];
	const drop = [];
	for (const cluster of clusters) {
		let best = cluster[0];
		for (const video of cluster.slice(1)) {
			const bestDuration = best.durationSeconds ?? 0;
			const duration = video.durationSeconds ?? 0;
			const later = (publishedTime(video.publishedAt) ?? 0) > (publishedTime(best.publishedAt) ?? 0);
			if (duration > bestDuration || (duration === bestDuration && later)) {
				drop.push(best);
				best = video;
			} else {
				drop.push(video);
			}
		}
		keep.push(best);
	}
	return { keep, drop };
}

/** Data API video: finished, public, and long enough to play. */
export function isCollectableYouTubeApiVideo(video) {
	if (video?.status?.uploadStatus !== 'processed') return false;
	if (video?.status?.privacyStatus !== 'public') return false;
	const live = video?.snippet?.liveBroadcastContent;
	if (live === 'live' || live === 'upcoming') return false;
	const durationSeconds = parseIso8601Duration(video?.contentDetails?.duration);
	return durationSeconds != null && durationSeconds > 0;
}

/** Innertube player payload: playable VOD with a non-zero length. */
export function isPlayablePlayerVideo(videoDetails, playabilityStatus) {
	const durationSeconds = Number(videoDetails?.lengthSeconds);
	if (playabilityStatus !== 'OK') return false;
	if (videoDetails?.isLive === true) return false;
	return Number.isFinite(durationSeconds) && durationSeconds > 0;
}

/** Player details. null means the request failed. */
export async function fetchYouTubePlayer(videoId) {
	const client = await youtubeInnertubeClient();
	for (let attempt = 0; attempt < 3; attempt++) {
		if (attempt > 0) await sleep(500 * attempt);
		const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(client.key)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
			body: JSON.stringify({
				context: { client: { clientName: 'WEB', clientVersion: client.version, hl: 'ko', gl: 'KR' } },
				videoId,
			}),
		});
		if (res.status === 429 || !res.ok) continue;
		const json = await res.json();
		const status = json.playabilityStatus?.status;
		if (!json.videoDetails?.videoId) {
			if (status === 'LIVE_STREAM_OFFLINE' || status === 'UNPLAYABLE') {
				return { tags: [], durationSeconds: null, playable: false };
			}
			continue;
		}
		const durationSeconds = Number(json.videoDetails.lengthSeconds);
		return {
			tags: uniqueTags(json.videoDetails.keywords ?? []),
			durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : null,
			playable: isPlayablePlayerVideo(json.videoDetails, json.playabilityStatus?.status),
		};
	}
	return null;
}

/** Tags the creator set on the video. null means the request failed. */
export async function fetchYouTubeTags(videoId) {
	const player = await fetchYouTubePlayer(videoId);
	return player ? player.tags : null;
}

export async function readBlogTagIndex(platform) {
	const feedUrl = platform === 'naver' ? NAVER_RSS : TISTORY_RSS;
	const res = await fetch(feedUrl, { headers: { 'User-Agent': UA } });
	if (!res.ok) throw new Error(`RSS fetch failed (${res.status}): ${feedUrl}`);
	const parsed = xmlParser.parse(await res.text());
	const index = new Map();
	for (const item of normalizeRssItems(parsed)) {
		const link = rssText(item.link?.['@_href'] ?? item.link ?? item.guid);
		const id =
			platform === 'naver'
				? link.match(/\/(\d{5,})(?:\?|#|$)/)?.[1]
				: link.match(/tistory\.com\/(\d+)/)?.[1];
		if (!id) continue;
		index.set(id, blogTagsFromRssItem(item, platform));
	}
	return index;
}

async function writeJson(dir, filename, data) {
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, filename), `${JSON.stringify(data, null, '\t')}\n`, 'utf8');
}

function canonicalFilename(data) {
	const url = String(data?.url ?? '');
	const videoId = url.match(/[?&]v=([\w-]{11})/)?.[1];
	if (videoId) return `yt-${videoId}.json`;

	if (url.includes('blog.naver.com') || data?.platform === 'naver') {
		const logNo = url.match(/\/(\d{8,})(?:\?|#|$)/)?.[1];
		if (logNo) return `naver-${logNo}.json`;
	}

	const tistoryId = url.match(/tistory\.com\/(\d+)(?:\?|#|$)/)?.[1];
	if (tistoryId) return `tistory-${tistoryId}.json`;
	return null;
}

export async function loadIdentityIndex(dir) {
	await fs.mkdir(dir, { recursive: true });
	const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.json'));
	const index = new Set(files);
	await Promise.all(
		files.map(async (file) => {
			try {
				const data = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
				const canonical = canonicalFilename(data);
				if (canonical) index.add(canonical);
			} catch {
				// A broken file still occupies its name, so it is not rewritten.
			}
		}),
	);
	return index;
}

export async function saveIfNew(dir, filename, data, index) {
	const canonical = canonicalFilename(data);
	if (index.has(filename) || (canonical && index.has(canonical))) return false;
	await writeJson(dir, filename, data);
	index.add(filename);
	if (canonical) index.add(canonical);
	return true;
}

export async function upsertTags(dir, filename, tags) {
	const filePath = path.join(dir, filename);
	const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
	const current = Array.isArray(data.tags) ? data.tags : [];
	const same = current.length === tags.length && current.every((tag, index) => tag === tags[index]);
	if (same) return false;
	data.tags = tags;
	await fs.writeFile(filePath, `${JSON.stringify(data, null, '\t')}\n`, 'utf8');
	return true;
}

async function discardSavedVideo(videoId, index) {
	const filename = `yt-${videoId}.json`;
	try {
		await fs.unlink(path.join(VIDEOS_DIR, filename));
	} catch (err) {
		if (err?.code === 'ENOENT') return false;
		throw err;
	}
	index?.delete(filename);
	return true;
}

async function archiveYouTubeEntries(entries, index) {
	const { keep, drop } = pickBroadcastVideos(entries);
	let removed = 0;
	for (const video of drop) {
		if (await discardSavedVideo(video.id, index)) {
			removed++;
			console.log(`✗ Removed shorter duplicate yt-${video.id}.json (${video.title})`);
		}
	}

	let added = 0;
	for (const video of keep) {
		const filename = `yt-${video.id}.json`;
		if (await saveIfNew(VIDEOS_DIR, filename, video.entry, index)) added++;
		else if (video.tags) await upsertTags(VIDEOS_DIR, filename, video.entry.tags);
	}
	return { added, kept: keep.length, dropped: drop.length, removed };
}

function httpError(message, status) {
	const err = new Error(message);
	if (Number.isInteger(status)) err.status = status;
	return err;
}

function redactSecrets(value) {
	return String(value).replace(/([?&]key=)[^&\s]+/gi, '$1***');
}

function warnSyncFailure(label, err) {
	const status = Number.isInteger(err?.status) ? `HTTP ${err.status}, ` : '';
	console.warn(`⚠ ${label} sync failed: ${status}${err?.message ?? err}`);
	console.warn(`⚠ ${label}: keeping existing saved content and continuing`);
}

async function fetchJson(url) {
	const res = await fetch(url);
	if (!res.ok) throw httpError(`HTTP ${res.status} for ${redactSecrets(url)}`, res.status);
	return res.json();
}

async function resolveYouTubeChannelId() {
	if (YOUTUBE_CHANNEL_ID) return YOUTUBE_CHANNEL_ID;

	const pageUrl = `https://www.youtube.com/@${YOUTUBE_HANDLE}`;
	const res = await fetch(pageUrl, {
		headers: { 'User-Agent': 'Mozilla/5.0 (compatible; jodong-content-hub/1.0)' },
	});
	if (!res.ok) throw httpError(`Cannot load YouTube channel page: HTTP ${res.status} ${pageUrl}`, res.status);

	const html = await res.text();
	const match =
		html.match(/"channelId":"(UC[\w-]{22})"/) ||
		html.match(/"externalId":"(UC[\w-]{22})"/) ||
		html.match(/channel_id=(UC[\w-]{22})/);

	if (!match) throw new Error('Could not resolve YouTube channel ID from handle page');
	return match[1];
}

function isRetryableStatus(status) {
	return status === 403 || status === 408 || status === 429 || status >= 500;
}

async function fetchYouTubeRssXml(feedUrl) {
	let lastError;
	for (let attempt = 1; attempt <= YOUTUBE_RSS_ATTEMPTS; attempt++) {
		try {
			const res = await fetch(feedUrl, {
				headers: {
					'User-Agent': BROWSER_UA,
					Accept: 'application/xml',
				},
			});
			if (res.ok) return await res.text();

			const snippet = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, 180);
			lastError = httpError(
				`YouTube RSS fetch failed: HTTP ${res.status} ${res.statusText}${snippet ? ` — ${snippet}` : ''} (${feedUrl})`,
				res.status,
			);
			if (!isRetryableStatus(res.status)) break;
		} catch (err) {
			lastError = err;
		}

		if (attempt >= YOUTUBE_RSS_ATTEMPTS) break;
		const delayMs = 1000 * 2 ** (attempt - 1);
		const status = Number.isInteger(lastError?.status) ? `HTTP ${lastError.status}` : 'network error';
		console.warn(
			`⚠ YouTube RSS attempt ${attempt}/${YOUTUBE_RSS_ATTEMPTS} failed (${status}): ${lastError?.message ?? lastError}. Retrying in ${delayMs}ms`,
		);
		await sleep(delayMs);
	}
	throw lastError;
}

async function youtubeTagsOrSkip(videoId) {
	try {
		return await fetchYouTubeTags(videoId);
	} catch (err) {
		console.warn(`⚠ YouTube tags skipped for ${videoId}: ${err?.message ?? err}`);
		return null;
	}
}

async function syncYouTubeRss() {
	try {
		return await syncYouTubeRssUnsafe();
	} catch (err) {
		warnSyncFailure('YouTube RSS', err);
		return 0;
	}
}

async function syncYouTubeRssUnsafe() {
	const channelId = await resolveYouTubeChannelId();
	const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
	const xml = await fetchYouTubeRssXml(feedUrl);
	const parsed = xmlParser.parse(xml);
	const items = normalizeRssItems(parsed).slice(0, MAX_VIDEOS);
	const index = await loadIdentityIndex(VIDEOS_DIR);

	const entries = [];
	let skipped = 0;
	for (const item of items) {
		const title = String(item.title?.['#text'] ?? item.title ?? 'Untitled').trim();
		const link = item.link?.['@_href'] ?? item.link ?? '';
		const videoId = item['yt:videoId']?.['#text'] ?? item['yt:videoId'] ?? link.match(/v=([^&]+)/)?.[1];
		const publishedAt = item.published ?? item.pubDate ?? new Date().toISOString();
		if (!videoId) continue;

		const player = await fetchYouTubePlayer(videoId).catch((err) => {
			console.warn(`⚠ YouTube player skipped for ${videoId}: ${err?.message ?? err}`);
			return null;
		});
		if (!player) {
			console.warn(`⚠ YouTube duration unknown for ${videoId}; left existing data unchanged`);
			continue;
		}
		if (!player.playable) {
			skipped++;
			if (await discardSavedVideo(videoId, index)) {
				console.log(`✗ Removed unplayable video yt-${videoId}.json`);
			}
			continue;
		}

		const published = new Date(publishedAt).toISOString();
		entries.push({
			id: videoId,
			title,
			publishedAt: published,
			durationSeconds: player.durationSeconds,
			tags: player.tags,
			entry: {
				title,
				url: `https://www.youtube.com/watch?v=${videoId}`,
				thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
				publishedAt: published,
				tags: player.tags ?? [],
			},
		});
	}

	const archived = await archiveYouTubeEntries(entries, index);
	console.log(
		`✓ YouTube (RSS fallback): ${archived.added} new, ${archived.kept - archived.added} already archived, ${skipped} unplayable, ${archived.dropped} shorter duplicate`,
	);
	return archived.added;
}

async function syncYouTube() {
	if (!YOUTUBE_API_KEY) {
		console.warn('⚠ YOUTUBE_API_KEY not set — using YouTube RSS fallback');
		return syncYouTubeRss();
	}

	try {
		return await syncYouTubeApi();
	} catch (err) {
		warnSyncFailure('YouTube', err);
		return 0;
	}
}

async function syncYouTubeApi() {
	const channelUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
	channelUrl.searchParams.set('part', 'contentDetails');
	channelUrl.searchParams.set('forHandle', YOUTUBE_HANDLE);
	channelUrl.searchParams.set('key', YOUTUBE_API_KEY);

	const channelData = await fetchJson(channelUrl);
	const channel = channelData.items?.[0];
	if (!channel) throw httpError(`YouTube channel not found for handle: ${YOUTUBE_HANDLE}`);

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
	videosUrl.searchParams.set('part', 'snippet,contentDetails,status');
	videosUrl.searchParams.set('id', videoIds.join(','));
	videosUrl.searchParams.set('key', YOUTUBE_API_KEY);

	const videosData = await fetchJson(videosUrl);
	const detailsById = new Map((videosData.items ?? []).map((video) => [video.id, video]));

	const index = await loadIdentityIndex(VIDEOS_DIR);

	const entries = [];
	let skipped = 0;
	for (const id of videoIds) {
		const video = detailsById.get(id);
		if (!video) continue;
		if (!isCollectableYouTubeApiVideo(video)) {
			skipped++;
			if (await discardSavedVideo(id, index)) {
				console.log(`✗ Removed unplayable video yt-${id}.json`);
			}
			continue;
		}

		const snippet = video.snippet ?? {};
		const title = snippet.title;
		const publishedAt = snippet.publishedAt;
		const thumb =
			snippet.thumbnails?.maxres?.url ||
			snippet.thumbnails?.high?.url ||
			snippet.thumbnails?.medium?.url ||
			`https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

		const tags = Array.isArray(snippet.tags) ? uniqueTags(snippet.tags) : await youtubeTagsOrSkip(id);
		entries.push({
			id,
			title,
			publishedAt,
			durationSeconds: parseIso8601Duration(video.contentDetails?.duration),
			tags,
			entry: {
				title,
				url: `https://www.youtube.com/watch?v=${id}`,
				thumbnailUrl: thumb,
				publishedAt,
				tags: tags ?? [],
			},
		});
	}

	const archived = await archiveYouTubeEntries(entries, index);
	console.log(
		`✓ YouTube: ${archived.added} new, ${archived.kept - archived.added} already archived, ${skipped} unplayable, ${archived.dropped} shorter duplicate`,
	);
	return archived.added;
}

function normalizeRssItems(parsed) {
	const channel = parsed.rss?.channel ?? parsed.feed;
	if (!channel) return [];

	const raw = channel.item ?? channel.entry ?? [];
	return Array.isArray(raw) ? raw : [raw];
}

async function syncRssFeed(feedUrl, platform) {
	const res = await fetch(feedUrl, { headers: { 'User-Agent': UA } });
	if (!res.ok) throw httpError(`RSS fetch failed: HTTP ${res.status} ${res.statusText} (${feedUrl})`, res.status);

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
				tags: blogTagsFromRssItem(item, platform),
				platform,
				...(description ? { summary: description.slice(0, 160) } : {}),
			},
		});
	}

	return entries;
}

async function syncPlatformFeed(label, feedUrl, platform) {
	try {
		return await syncRssFeed(feedUrl, platform);
	} catch (err) {
		warnSyncFailure(label, err);
		return [];
	}
}

async function syncBlogs() {
	const tistory = await syncPlatformFeed('Tistory', TISTORY_RSS, 'tistory');
	const naver = await syncPlatformFeed('Naver', NAVER_RSS, 'naver');
	const all = [...tistory, ...naver];

	const index = await loadIdentityIndex(BLOG_DIR);
	let added = 0;
	for (const { filename, data } of all) {
		if (await saveIfNew(BLOG_DIR, filename, data, index)) added++;
		else await upsertTags(BLOG_DIR, filename, data.tags);
	}

	console.log(
		`✓ Blogs: ${added} new, ${all.length - added} already archived (tistory ${tistory.length}, naver ${naver.length})`,
	);
	return added;
}

async function main() {
	console.log('Syncing content…');
	const yt = await syncYouTube();
	const blogs = await syncBlogs();
	console.log(`Done. YouTube: ${yt}, Blogs: ${blogs}`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
if (invokedPath.toLowerCase() === selfPath.toLowerCase()) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
