import { neon } from '@neondatabase/serverless';
import { env } from './env';

type Sql = ReturnType<typeof neon>;

let sqlClient: Sql | undefined;
let ready: Promise<void> | undefined;

async function createTables(sql: Sql) {
	await sql`
		CREATE TABLE IF NOT EXISTS notes (
			id SERIAL PRIMARY KEY,
			body TEXT NOT NULL,
			is_public BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`;
	await sql`
		CREATE TABLE IF NOT EXISTS milestones (
			id SERIAL PRIMARY KEY,
			year TEXT NOT NULL,
			title TEXT NOT NULL,
			body TEXT NOT NULL DEFAULT '',
			sort_order INTEGER NOT NULL DEFAULT 0
		)
	`;
}

/** DB 연결을 돌려줍니다. 처음 한 번 필요한 테이블(글 보관 칸)을 자동으로 만듭니다. */
export async function getDb(): Promise<Sql> {
	const url = env('DATABASE_URL') ?? env('POSTGRES_URL');
	if (!url) {
		throw new Error('DATABASE_URL 이 설정되어 있지 않습니다. README의 "아지트 설정"을 확인하세요.');
	}
	sqlClient ??= neon(url);
	ready ??= createTables(sqlClient).catch((err) => {
		ready = undefined;
		throw err;
	});
	await ready;
	return sqlClient;
}
