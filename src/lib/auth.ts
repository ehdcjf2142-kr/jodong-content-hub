import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { env, requireEnv } from './env';

export const SESSION_COOKIE = 'session';
export const STATE_COOKIE = 'oauth_state';
const SESSION_DAYS = 30;

function sign(data: string): string {
	return createHmac('sha256', requireEnv('AUTH_SECRET')).update(data).digest('base64url');
}

/** 로그인 성공 시 브라우저에 줄 "출입증" 값을 만듭니다. */
export function createSessionToken(email: string): string {
	const payload = Buffer.from(
		JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000 }),
	).toString('base64url');
	return `${payload}.${sign(payload)}`;
}

/** 출입증이 진짜이고 내 이메일일 때만 true. */
export function isAdminToken(token: string | undefined): boolean {
	if (!token) return false;
	const adminEmail = env('ADMIN_EMAIL')?.trim().toLowerCase();
	if (!adminEmail || !env('AUTH_SECRET')) return false;

	const [payload, signature] = token.split('.');
	if (!payload || !signature) return false;

	const expected = Buffer.from(sign(payload));
	const given = Buffer.from(signature);
	if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

	try {
		const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
			email?: string;
			exp?: number;
		};
		return data.email?.toLowerCase() === adminEmail && typeof data.exp === 'number' && data.exp > Date.now();
	} catch {
		return false;
	}
}

export function setSessionCookie(cookies: AstroCookies, email: string) {
	cookies.set(SESSION_COOKIE, createSessionToken(email), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: !import.meta.env.DEV,
		maxAge: SESSION_DAYS * 24 * 60 * 60,
	});
}
