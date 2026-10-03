/**
 * One-shot backfill of the full Naver, Tistory, and YouTube archives.
 * Existing JSON files are kept. Re-running only adds items that are not stored yet.
 */

import { XMLParser } from 'fast-xml-parser';
import * as sync from './sync-content.mjs';

const { BLOG_DIR, VIDEOS_DIR, loadIdentityIndex, saveIfNew, stripHtml } = sync;

function uniqueTags(values) {
	if (typeof sync.uniqueTags === 'function') return sync.uniqueTags(values);
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

function categorizeVideo(title, description = '') {
	if (typeof sync.categorizeVideo === 'function') return sync.categorizeVideo(title, description);
	const text = `${title} ${description}`.toLowerCase();
	if (/쇼츠|시|poem|낭독|visual/.test(text)) return 'visual-poem';
	if (/모바일|mobile|찍먹|gacha|리듬|터치/.test(text)) return 'mobile-review';
	return 'game-analysis';
}

function videoEntry(id, micro) {
	return {
		title: micro.title,
		url: `https://www.youtube.com/watch?v=${id}`,
		thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
		publishedAt: new Date(micro.publishDate).toISOString(),
		tags: micro.tags?.length ? micro.tags : (sync.extractTags?.(micro.title, micro.description ?? '') ?? []),
		category: categorizeVideo(micro.title, micro.description ?? ''),
	};
}

const UA = 'Mozilla/5.0 (compatible; jodong-content-hub/1.0)';
const NAVER_BLOG_ID = 'gamelifeequation';
const TISTORY_ORIGIN = 'https://jodongbro.tistory.com';
const YOUTUBE_HANDLE = 'JodongBroOfficial';

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, headers = {}) {
	const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	return res.text();
}

function decodeTitle(raw) {
	const text = String(raw ?? '').replace(/\+/g, ' ');
	try {
		return decodeURIComponent(text).trim();
	} catch {
		return text.trim();
	}
}

function parseNaverDate(raw) {
	const match = String(raw ?? '').match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
	if (!match) return new Date().toISOString();
	const [, year, month, day] = match;
	return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T00:00:00+09:00`).toISOString();
}

function rssText(value) {
	if (value == null) return '';
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	return String(value['#text'] ?? value['@_href'] ?? '');
}

async function backfillNaver(index) {
	const tagIndex = sync.readBlogTagIndex ? await sync.readBlogTagIndex('naver') : null;
	const countPerPage = 30;
	let page = 1;
	let total = Infinity;
	let listed = 0;
	let added = 0;

	while ((page - 1) * countPerPage < total && page <= 200) {
		const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${NAVER_BLOG_ID}&currentPage=${page}&countPerPage=${countPerPage}`;
		const res = await fetch(url, {
			headers: { 'User-Agent': UA, Referer: `https://blog.naver.com/${NAVER_BLOG_ID}` },
		});
		if (!res.ok) throw new Error(`Naver list failed (${res.status}) page ${page}`);
		const data = JSON.parse((await res.text()).replace(/\\'/g, "'"));
		total = Number(data.totalCount ?? 0);
		const posts = data.postList ?? [];
		if (posts.length === 0) break;

		for (const post of posts) {
			if (Number(post.isPostBlocked) || String(post.isPostNotOpen) === '1') continue;
			const logNo = String(post.logNo ?? '');
			const title = decodeTitle(post.title);
			if (!logNo || !title) continue;
			listed++;
			const entry = {
				title,
				url: `https://blog.naver.com/${NAVER_BLOG_ID}/${logNo}`,
				publishedAt: parseNaverDate(post.addDate),
				tags: tagIndex?.get(logNo) ?? sync.extractTags?.(title) ?? [],
				platform: 'naver',
			};
			if (await saveIfNew(BLOG_DIR, `naver-${logNo}.json`, entry, index)) added++;
		}

		if (posts.length < countPerPage) break;
		page++;
	}

	console.log(`✓ Naver: ${added} new, ${listed} listed (archive total ${total})`);
	return { added, listed, total };
}

async function backfillTistory(index) {
	const posts = new Map();

	const sitemap = await fetchText(`${TISTORY_ORIGIN}/sitemap.xml`);
	for (const match of sitemap.matchAll(/<loc>https:\/\/jodongbro\.tistory\.com\/(\d+)<\/loc>/g)) {
		posts.set(match[1], { url: `${TISTORY_ORIGIN}/${match[1]}` });
	}

	const rss = await fetchText(`${TISTORY_ORIGIN}/rss`);
	const parsed = xmlParser.parse(rss);
	const channel = parsed.rss?.channel ?? parsed.feed;
	const rawItems = channel?.item ?? channel?.entry ?? [];
	const items = Array.isArray(rawItems) ? rawItems : [rawItems];
	for (const item of items) {
		const link = rssText(item.link).trim();
		const id = link.match(/tistory\.com\/(\d+)/)?.[1];
		if (!id) continue;
		const title = rssText(item.title).trim();
		const publishedAt = item.pubDate ?? item.published ?? item.updated;
		const summary = stripHtml(rssText(item.description ?? item.summary));
		const current = posts.get(id) ?? { url: link };
		posts.set(id, {
			...current,
			url: link || current.url,
			title,
			publishedAt: publishedAt ? new Date(publishedAt).toISOString() : current.publishedAt,
			summary,
			tags: sync.blogTagsFromRssItem?.(item, 'tistory') ?? sync.extractTags?.(title, summary) ?? [],
		});
	}

	const seenOnPages = new Set();
	for (let page = 1; page <= 50; page++) {
		const html = await fetchText(`${TISTORY_ORIGIN}/?page=${page}`);
		const ids = [...new Set([...html.matchAll(/href="\/(\d+)"/g)].map((match) => match[1]))];
		const fresh = ids.filter((id) => !seenOnPages.has(id));
		if (fresh.length === 0) break;
		for (const id of fresh) {
			seenOnPages.add(id);
			if (!posts.has(id)) posts.set(id, { url: `${TISTORY_ORIGIN}/${id}` });
		}
	}

	let added = 0;
	for (const [id, post] of posts) {
		if (!post.title || !post.publishedAt) {
			const html = await fetchText(post.url);
			post.title ||= html.match(/property="og:title" content="([^"]*)"/)?.[1]?.trim() || `Tistory ${id}`;
			post.publishedAt ||= html.match(/property="article:published_time" content="([^"]+)"/)?.[1];
			post.publishedAt = post.publishedAt ? new Date(post.publishedAt).toISOString() : new Date().toISOString();
		}

		const entry = {
			title: post.title,
			url: post.url,
			publishedAt: post.publishedAt,
			tags: post.tags ?? [],
			platform: 'tistory',
			...(post.summary ? { summary: post.summary.slice(0, 160) } : {}),
		};
		if (await saveIfNew(BLOG_DIR, `tistory-${id}.json`, entry, index)) added++;
	}

	console.log(`✓ Tistory: ${added} new, ${posts.size} listed`);
	return { added, listed: posts.size };
}

function extractYtInitialData(html) {
	const marker = 'ytInitialData = ';
	const start = html.indexOf(marker);
	if (start < 0) return null;
	const jsonStart = start + marker.length;
	if (html[jsonStart] !== '{') return null;

	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = jsonStart; i < html.length; i++) {
		const char = html[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === '\\') escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === '{') depth++;
		else if (char === '}') {
			depth--;
			if (depth === 0) return JSON.parse(html.slice(jsonStart, i + 1));
		}
	}
	return null;
}

function continuationToken(item) {
	return (
		item.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token ??
		item.continuationItemViewModel?.continuationCommand?.innertubeCommand?.continuationCommand?.token ??
		null
	);
}

function findReelId(node, depth = 0) {
	if (!node || typeof node !== 'object' || depth > 8) return null;
	if (typeof node.reelWatchEndpoint?.videoId === 'string') return node.reelWatchEndpoint.videoId;
	for (const value of Object.values(node)) {
		const found = findReelId(value, depth + 1);
		if (found) return found;
	}
	return null;
}

function videoIdFromItem(item) {
	const content = item.richItemRenderer?.content;
	const lockup = item.lockupViewModel ?? content?.lockupViewModel;
	if (lockup?.contentId && lockup.contentType !== 'LOCKUP_CONTENT_TYPE_PLAYLIST') return lockup.contentId;
	const shortsId = findReelId(item.shortsLockupViewModel ?? content?.shortsLockupViewModel);
	if (shortsId) return shortsId;
	return content?.videoRenderer?.videoId ?? content?.reelItemRenderer?.videoId ?? null;
}

function titleFromItem(item) {
	const content = item.richItemRenderer?.content;
	const lockup = item.lockupViewModel ?? content?.lockupViewModel;
	return (
		lockup?.metadata?.lockupMetadataViewModel?.title?.content ??
		content?.videoRenderer?.title?.runs?.[0]?.text ??
		content?.videoRenderer?.title?.simpleText ??
		''
	);
}

function continuationItems(json) {
	const actions = json.onResponseReceivedActions ?? [];
	return actions.flatMap(
		(action) =>
			action.appendContinuationItemsAction?.continuationItems ??
			action.reloadContinuationItemsCommand?.continuationItems ??
			[],
	);
}

async function ytBrowse(key, version, body) {
	const res = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(key)}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
		body: JSON.stringify({
			context: { client: { clientName: 'WEB', clientVersion: version, hl: 'ko', gl: 'KR' } },
			...body,
		}),
	});
	if (!res.ok) throw new Error(`YouTube browse failed (${res.status})`);
	return res.json();
}

async function collectGrid(key, version, items, into, label) {
	const seenTokens = new Set();
	let current = items;
	let page = 0;
	while (current?.length) {
		page++;
		let token = null;
		for (const item of current) {
			const id = videoIdFromItem(item);
			if (id) into.set(id, titleFromItem(item) || into.get(id) || '');
			token ??= continuationToken(item);
		}
		console.log(`  ${label} page ${page}: ${into.size} videos, continuation ${token ? 'yes' : 'no'}`);
		if (!token || seenTokens.has(token)) break;
		seenTokens.add(token);
		const json = await ytBrowse(key, version, { continuation: token });
		current = continuationItems(json);
	}
}

function tabByTitle(tabs, titles) {
	return tabs.find((tab) => titles.includes(tab.tabRenderer?.title));
}

async function collectBrowseTab(key, version, tab, into, label) {
	const endpoint = tab?.tabRenderer?.endpoint?.browseEndpoint;
	if (!endpoint?.browseId) return;
	const json = await ytBrowse(key, version, {
		browseId: endpoint.browseId,
		params: endpoint.params,
	});
	const selected = (json.contents?.twoColumnBrowseResultsRenderer?.tabs ?? []).find(
		(item) => item.tabRenderer?.content?.richGridRenderer,
	);
	await collectGrid(key, version, selected?.tabRenderer?.content?.richGridRenderer?.contents ?? [], into, label);
}

function playlistItems(data) {
	const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
	for (const tab of tabs) {
		const sections = tab.tabRenderer?.content?.sectionListRenderer?.contents ?? [];
		for (const section of sections) {
			const items = section.itemSectionRenderer?.contents;
			if (Array.isArray(items) && items.length) return items;
		}
	}
	return [];
}

async function fetchPlayer(key, version, videoId) {
	for (let attempt = 0; attempt < 3; attempt++) {
		if (attempt > 0) await sleep(700 * attempt);
		const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(key)}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
			body: JSON.stringify({
				context: { client: { clientName: 'WEB', clientVersion: version, hl: 'ko', gl: 'KR' } },
				videoId,
			}),
		});
		if (res.status === 429) continue;
		if (!res.ok) continue;
		const json = await res.json();
		const micro = json.microformat?.playerMicroformatRenderer;
		if (micro?.publishDate && micro?.title?.simpleText) {
			return {
				title: micro.title.simpleText,
				description: micro.description?.simpleText ?? '',
				publishDate: micro.publishDate,
				tags: uniqueTags(json.videoDetails?.keywords ?? []),
			};
		}
	}
	return null;
}

async function backfillYouTube(index) {
	const html = await fetchText(`https://www.youtube.com/@${YOUTUBE_HANDLE}/videos`, {
		'Accept-Language': 'ko-KR,ko;q=0.9',
	});
	const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
	const version = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
	const data = extractYtInitialData(html);
	if (!key || !version || !data) throw new Error('Could not read the YouTube channel page');

	const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs ?? [];
	const videosTab = tabByTitle(tabs, ['동영상', 'Videos']);
	const shortsTab = tabByTitle(tabs, ['Shorts']);
	const liveTab = tabByTitle(tabs, ['라이브', 'Live', 'Streams']);
	const videos = new Map();

	await collectGrid(
		key,
		version,
		videosTab?.tabRenderer?.content?.richGridRenderer?.contents ?? [],
		videos,
		'videos',
	);
	await collectBrowseTab(key, version, liveTab, videos, 'live');
	await collectBrowseTab(key, version, shortsTab, videos, 'shorts');

	const channelId = videosTab?.tabRenderer?.endpoint?.browseEndpoint?.browseId;
	if (channelId?.startsWith('UC')) {
		const playlistHtml = await fetchText(`https://www.youtube.com/playlist?list=UU${channelId.slice(2)}`, {
			'Accept-Language': 'ko-KR,ko;q=0.9',
		});
		const playlistKey = playlistHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? key;
		const playlistVersion = playlistHtml.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? version;
		const playlistData = extractYtInitialData(playlistHtml);
		await collectGrid(playlistKey, playlistVersion, playlistItems(playlistData), videos, 'uploads');
	}

	const ids = [...videos.keys()].filter((id) => !index.has(`yt-${id}.json`));
	console.log(`YouTube list: ${videos.size} videos. Fetching publish dates for ${ids.length} new…`);
	const failed = [];
	let added = 0;
	let done = 0;
	let cursor = 0;

	async function worker() {
		while (cursor < ids.length) {
			const id = ids[cursor++];
			await sleep(120);
			const micro = await fetchPlayer(key, version, id);
			done++;
			if (!micro) {
				failed.push(id);
				continue;
			}
			if (await saveIfNew(VIDEOS_DIR, `yt-${id}.json`, videoEntry(id, micro), index)) added++;
			if (done % 25 === 0 || done === ids.length) console.log(`  dates ${done}/${ids.length}`);
		}
	}

	await Promise.all(Array.from({ length: 4 }, () => worker()));

	if (failed.length) {
		console.warn(`Retrying ${failed.length} videos with missing dates…`);
		const stillFailed = [];
		for (const id of failed) {
			await sleep(500);
			const micro = await fetchPlayer(key, version, id);
			if (!micro) {
				stillFailed.push(id);
				continue;
			}
			if (await saveIfNew(VIDEOS_DIR, `yt-${id}.json`, videoEntry(id, micro), index)) added++;
		}
		if (stillFailed.length) {
			throw new Error(`Missing publish dates for ${stillFailed.length} videos: ${stillFailed.join(', ')}`);
		}
	}

	console.log(`✓ YouTube: ${added} new, ${videos.size} listed`);
	return { added, listed: videos.size };
}

async function main() {
	const only = process.argv[2];
	console.log('Backfilling archives…');
	const blogs = await loadIdentityIndex(BLOG_DIR);
	const videos = await loadIdentityIndex(VIDEOS_DIR);
	const naver = !only || only === 'naver' ? await backfillNaver(blogs) : null;
	const tistory = !only || only === 'tistory' ? await backfillTistory(blogs) : null;
	const youtube = !only || only === 'youtube' ? await backfillYouTube(videos) : null;
	console.log(
		`Done. Naver ${naver?.listed ?? 'skipped'}, Tistory ${tistory?.listed ?? 'skipped'}, YouTube ${youtube?.listed ?? 'skipped'}. New files: blogs ${(naver?.added ?? 0) + (tistory?.added ?? 0)}, videos ${youtube?.added ?? 0}.`,
	);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
