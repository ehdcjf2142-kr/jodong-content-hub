import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { STATE_COOKIE } from '../../../lib/auth';
import { requireEnv } from '../../../lib/env';

export const prerender = false;

// 구글 로그인 화면으로 보냅니다.
export const GET: APIRoute = ({ url, cookies, redirect }) => {
	const state = randomBytes(16).toString('hex');
	cookies.set(STATE_COOKIE, state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !import.meta.env.DEV,
		maxAge: 600,
	});

	const params = new URLSearchParams({
		client_id: requireEnv('GOOGLE_CLIENT_ID'),
		redirect_uri: `${url.origin}/api/auth/callback`,
		response_type: 'code',
		scope: 'openid email',
		state,
		prompt: 'select_account',
	});

	return redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
