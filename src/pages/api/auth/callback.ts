import type { APIRoute } from 'astro';
import { STATE_COOKIE, setSessionCookie } from '../../../lib/auth';
import { env, requireEnv } from '../../../lib/env';

export const prerender = false;

// 구글에서 로그인을 마치고 돌아오는 곳. 내 이메일일 때만 통과시킵니다.
export const GET: APIRoute = async ({ url, cookies, redirect }) => {
	const savedState = cookies.get(STATE_COOKIE)?.value;
	cookies.delete(STATE_COOKIE, { path: '/' });

	const code = url.searchParams.get('code');
	if (!code || !savedState || url.searchParams.get('state') !== savedState) {
		return redirect('/admin/login/?error=state');
	}

	const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			code,
			client_id: requireEnv('GOOGLE_CLIENT_ID'),
			client_secret: requireEnv('GOOGLE_CLIENT_SECRET'),
			redirect_uri: `${url.origin}/api/auth/callback`,
			grant_type: 'authorization_code',
		}),
	});
	if (!tokenRes.ok) return redirect('/admin/login/?error=token');
	const { access_token } = (await tokenRes.json()) as { access_token?: string };
	if (!access_token) return redirect('/admin/login/?error=token');

	const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
		headers: { Authorization: `Bearer ${access_token}` },
	});
	if (!userRes.ok) return redirect('/admin/login/?error=token');
	const user = (await userRes.json()) as { email?: string; email_verified?: boolean };

	const adminEmail = env('ADMIN_EMAIL')?.trim().toLowerCase();
	if (!adminEmail || !user.email_verified || user.email?.toLowerCase() !== adminEmail) {
		return redirect('/admin/login/?error=denied');
	}

	setSessionCookie(cookies, user.email);
	return redirect('/admin/');
};
