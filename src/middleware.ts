import { defineMiddleware } from 'astro:middleware';
import { SESSION_COOKIE, isAdminToken } from './lib/auth';

export const onRequest = defineMiddleware(async (context, next) => {
	// 미리 만들어 두는 정적 페이지는 로그인 확인이 필요 없습니다.
	if (context.isPrerendered) return next();

	const isAdmin = isAdminToken(context.cookies.get(SESSION_COOKIE)?.value);
	context.locals.isAdmin = isAdmin;

	const path = context.url.pathname;
	const isAdminArea = path === '/admin' || path.startsWith('/admin/');
	const isLoginPage = path === '/admin/login' || path === '/admin/login/';

	if (isAdminArea && !isLoginPage && !isAdmin) {
		return context.redirect('/admin/login/');
	}

	return next();
});
