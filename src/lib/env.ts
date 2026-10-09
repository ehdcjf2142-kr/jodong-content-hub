// 서버 전용 비밀 값(.env / Vercel 환경변수)을 읽습니다.
export function env(key: string): string | undefined {
	const fromProcess = process.env[key];
	if (fromProcess) return fromProcess;
	const fromVite = (import.meta.env as Record<string, string | undefined>)[key];
	return fromVite || undefined;
}

export function requireEnv(key: string): string {
	const value = env(key);
	if (!value) {
		throw new Error(`환경변수 ${key} 가 설정되어 있지 않습니다. README의 "아지트 설정"을 확인하세요.`);
	}
	return value;
}
