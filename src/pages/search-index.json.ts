import type { APIRoute } from 'astro';
import { getAllFeedItems } from '../lib/content';
import { toSearchIndexRows } from '../lib/search';

export const prerender = true;

export const GET: APIRoute = async () => {
	const items = await getAllFeedItems();
	const body = JSON.stringify(toSearchIndexRows(items));
	return new Response(body, {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
		},
	});
};
