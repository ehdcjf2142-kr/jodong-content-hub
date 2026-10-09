import { getDb } from './db';

export interface Milestone {
	id: number;
	year: string;
	title: string;
	body: string;
	sortOrder: number;
}

type Row = { id: number; year: string; title: string; body: string; sort_order: number };

export async function listMilestones(): Promise<Milestone[]> {
	const sql = await getDb();
	const rows = (await sql`SELECT id, year, title, body, sort_order FROM milestones ORDER BY sort_order, id`) as Row[];
	return rows.map((r) => ({ id: r.id, year: r.year, title: r.title, body: r.body, sortOrder: r.sort_order }));
}

export async function addMilestone(year: string, title: string, body: string) {
	const sql = await getDb();
	await sql`
		INSERT INTO milestones (year, title, body, sort_order)
		VALUES (${year}, ${title}, ${body}, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM milestones))
	`;
}

export async function updateMilestone(id: number, year: string, title: string, body: string) {
	const sql = await getDb();
	await sql`UPDATE milestones SET year = ${year}, title = ${title}, body = ${body} WHERE id = ${id}`;
}

export async function deleteMilestone(id: number) {
	const sql = await getDb();
	await sql`DELETE FROM milestones WHERE id = ${id}`;
}

/** 위(-1) 또는 아래(+1)로 한 칸 옮깁니다. */
export async function moveMilestone(id: number, direction: -1 | 1) {
	const items = await listMilestones();
	const index = items.findIndex((m) => m.id === id);
	const target = index + direction;
	if (index < 0 || target < 0 || target >= items.length) return;

	[items[index], items[target]] = [items[target], items[index]];

	const sql = await getDb();
	for (const [i, m] of items.entries()) {
		await sql`UPDATE milestones SET sort_order = ${i + 1} WHERE id = ${m.id}`;
	}
}
