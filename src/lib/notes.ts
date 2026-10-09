import { getDb } from './db';

export interface Note {
	id: number;
	body: string;
	isPublic: boolean;
	createdAt: Date;
}

type Row = { id: number; body: string; is_public: boolean; created_at: string | Date };

function toNote(r: Row): Note {
	return { id: r.id, body: r.body, isPublic: r.is_public, createdAt: new Date(r.created_at) };
}

/** includePrivate 가 false 이면 공개 글만 돌려줍니다. */
export async function listNotes(includePrivate: boolean): Promise<Note[]> {
	const sql = await getDb();
	const rows = (
		includePrivate
			? await sql`SELECT id, body, is_public, created_at FROM notes ORDER BY created_at DESC, id DESC`
			: await sql`SELECT id, body, is_public, created_at FROM notes WHERE is_public ORDER BY created_at DESC, id DESC`
	) as Row[];
	return rows.map(toNote);
}

export async function addNote(body: string, isPublic: boolean) {
	const sql = await getDb();
	await sql`INSERT INTO notes (body, is_public) VALUES (${body}, ${isPublic})`;
}

export async function updateNote(id: number, body: string, isPublic: boolean) {
	const sql = await getDb();
	await sql`UPDATE notes SET body = ${body}, is_public = ${isPublic} WHERE id = ${id}`;
}

export async function deleteNote(id: number) {
	const sql = await getDb();
	await sql`DELETE FROM notes WHERE id = ${id}`;
}
