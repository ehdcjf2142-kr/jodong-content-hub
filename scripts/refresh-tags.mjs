/**
 * Replace stored tags with the tags set on the original post or video.
 * Naver and Tistory come from RSS. YouTube comes from the video's keywords.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import {
	BLOG_DIR,
	VIDEOS_DIR,
	fetchYouTubeTags,
	readBlogTagIndex,
	upsertTags,
} from './sync-content.mjs';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshBlogs() {
	const [naver, tistory] = await Promise.all([readBlogTagIndex('naver'), readBlogTagIndex('tistory')]);
	const files = (await fs.readdir(BLOG_DIR)).filter((file) => file.endsWith('.json'));
	let updated = 0;
	let missing = 0;

	for (const file of files) {
		const data = JSON.parse(await fs.readFile(path.join(BLOG_DIR, file), 'utf8'));
		const naverId = file.match(/^naver-(\d+)\.json$/)?.[1];
		const tistoryId = file.match(/^tistory-(\d+)\.json$/)?.[1];
		const tags = naverId ? naver.get(naverId) : tistoryId ? tistory.get(tistoryId) : undefined;
		if (!tags) missing++;
		if (await upsertTags(BLOG_DIR, file, tags ?? [])) updated++;
	}

	console.log(
		`✓ Blogs: ${files.length} files, ${updated} tag lists rewritten, ${missing} not found in RSS (cleared)`,
	);
}

async function refreshVideos() {
	const files = (await fs.readdir(VIDEOS_DIR)).filter((file) => file.endsWith('.json'));
	let cursor = 0;
	let updated = 0;
	let failed = [];
	let done = 0;

	async function worker() {
		while (cursor < files.length) {
			const file = files[cursor++];
			const id = file.match(/^yt-(.+)\.json$/)?.[1];
			if (!id) continue;
			await sleep(120);
			const tags = await fetchYouTubeTags(id);
			done++;
			if (!tags) {
				failed.push(file);
			} else if (await upsertTags(VIDEOS_DIR, file, tags)) {
				updated++;
			}
			if (done % 25 === 0 || done === files.length) console.log(`  videos ${done}/${files.length}`);
		}
	}

	await Promise.all(Array.from({ length: 4 }, () => worker()));

	const stillFailed = [];
	for (const file of failed) {
		const id = file.match(/^yt-(.+)\.json$/)?.[1];
		await sleep(600);
		const tags = await fetchYouTubeTags(id);
		if (!tags) {
			stillFailed.push(file);
			if (await upsertTags(VIDEOS_DIR, file, [])) updated++;
			continue;
		}
		if (await upsertTags(VIDEOS_DIR, file, tags)) updated++;
	}

	console.log(`✓ Videos: ${files.length} files, ${updated} tag lists rewritten`);
	if (stillFailed.length) console.warn(`  cleared after failed lookup: ${stillFailed.join(', ')}`);
}

await refreshBlogs();
await refreshVideos();
