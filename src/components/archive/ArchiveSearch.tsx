import { Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SearchIndexRow } from '../../lib/types';

type SortMode = 'relevance' | 'date';
type PlatformFilter = 'youtube' | 'tistory' | 'naver';

const PLATFORM_LABELS: Record<PlatformFilter, string> = {
	youtube: 'YouTube',
	tistory: 'Tistory',
	naver: 'Naver',
};

function formatShort(iso: string): string {
	try {
		return new Date(iso).toLocaleDateString('ko-KR', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		});
	} catch {
		return iso;
	}
}

function kindLabel(row: SearchIndexRow): string {
	if (row.kind === 'youtube') return 'YouTube';
	if (row.platform === 'tistory') return 'Tistory';
	if (row.platform === 'naver') return 'Naver';
	return row.kind;
}

function sortByDate(rows: SearchIndexRow[]): SearchIndexRow[] {
	return [...rows].sort(
		(a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
	);
}

function queryTokens(query: string): string[] {
	return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function tokenInTitle(row: SearchIndexRow, token: string): boolean {
	return row.title.toLowerCase().includes(token);
}

function tokenInTags(row: SearchIndexRow, token: string): boolean {
	return row.tags.some((tag) => tag.toLowerCase().includes(token));
}

function tokenInSummary(row: SearchIndexRow, token: string): boolean {
	return (row.summary ?? '').toLowerCase().includes(token);
}

function matchesTokens(row: SearchIndexRow, tokens: string[]): boolean {
	return tokens.every(
		(token) => tokenInTitle(row, token) || tokenInTags(row, token) || tokenInSummary(row, token),
	);
}

function compareRelevance(a: SearchIndexRow, b: SearchIndexRow, tokens: string[]): number {
	const score = (row: SearchIndexRow) => {
		let title = 0;
		let tags = 0;
		let summary = 0;
		for (const token of tokens) {
			if (tokenInTitle(row, token)) title++;
			if (tokenInTags(row, token)) tags++;
			if (tokenInSummary(row, token)) summary++;
		}
		return { title, tags, summary };
	};
	const left = score(a);
	const right = score(b);
	if (right.title !== left.title) return right.title - left.title;
	if (right.tags !== left.tags) return right.tags - left.tags;
	if (right.summary !== left.summary) return right.summary - left.summary;
	return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

function chipClass(active: boolean): string {
	return [
		'rounded-lg px-2.5 py-1 text-xs font-medium transition',
		active
			? 'bg-violet-600 text-white dark:bg-violet-500'
			: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700',
	].join(' ');
}

function toggleChipClass(active: boolean): string {
	return [
		'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
		active
			? 'bg-violet-600 text-white dark:bg-violet-500'
			: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700',
	].join(' ');
}

const PAGE_SIZES = [10, 30, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];
const PAGE_JUMP = 5;

type PageSlot = number | { jumpTo: number };

function pageWindow(current: number, total: number): PageSlot[] {
	if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

	const shown = new Set<number>([1, total]);
	for (let page = current - 2; page <= current + 2; page++) {
		if (page >= 1 && page <= total) shown.add(page);
	}

	const sorted = [...shown].sort((a, b) => a - b);
	const slots: PageSlot[] = [];
	for (let index = 0; index < sorted.length; index++) {
		const page = sorted[index];
		const previous = sorted[index - 1];
		if (index > 0 && page - previous > 1) {
			const toward = page < current ? current - PAGE_JUMP : current + PAGE_JUMP;
			const jumpTo = Math.min(page - 1, Math.max(previous + 1, toward));
			slots.push({ jumpTo });
		}
		slots.push(page);
	}
	return slots;
}

export default function ArchiveSearch() {
	const [items, setItems] = useState<SearchIndexRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const [sortMode, setSortMode] = useState<SortMode>('relevance');
	const [platforms, setPlatforms] = useState<Set<PlatformFilter>>(new Set());
	const [pageSize, setPageSize] = useState<PageSize>(10);
	const [page, setPage] = useState(1);

	useEffect(() => {
		let cancelled = false;

		async function load() {
			try {
				const res = await fetch('/search-index.json');
				if (!res.ok) throw new Error(`인덱스를 불러오지 못했습니다 (${res.status})`);
				const data = (await res.json()) as SearchIndexRow[];
				if (!cancelled) {
					setItems(data);
					setError(null);
				}
			} catch (e) {
				if (!cancelled) {
					setError(e instanceof Error ? e.message : '알 수 없는 오류');
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		load();
		return () => {
			cancelled = true;
		};
	}, []);

	const filtered = useMemo(() => {
		if (platforms.size === 0) return items;
		return items.filter((row) => {
			if (row.kind === 'youtube') return platforms.has('youtube');
			if (row.platform === 'tistory') return platforms.has('tistory');
			if (row.platform === 'naver') return platforms.has('naver');
			return false;
		});
	}, [items, platforms]);

	const tokens = queryTokens(query);

	const results = useMemo(() => {
		const rows = tokens.length === 0 ? filtered : filtered.filter((row) => matchesTokens(row, tokens));
		if (tokens.length === 0 || sortMode === 'date') return sortByDate(rows);
		return [...rows].sort((a, b) => compareRelevance(a, b, tokens));
	}, [filtered, tokens, sortMode]);

	const effectiveSort: SortMode = tokens.length > 0 ? sortMode : 'date';
	const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
	const current = Math.min(page, pageCount);
	const startIndex = (current - 1) * pageSize;
	const visible = results.slice(startIndex, startIndex + pageSize);
	const pages = useMemo(() => pageWindow(current, pageCount), [current, pageCount]);
	const rangeStart = results.length === 0 ? 0 : startIndex + 1;
	const rangeEnd = startIndex + visible.length;

	function resetPage() {
		setPage(1);
	}

	function togglePlatform(p: PlatformFilter) {
		setPlatforms((prev) => {
			const next = new Set(prev);
			if (next.has(p)) next.delete(p);
			else next.add(p);
			return next;
		});
		resetPage();
	}

	function selectPageSize(size: PageSize) {
		setPageSize(size);
		resetPage();
	}

	if (loading) {
		return (
			<div className="flex items-center justify-center gap-2 rounded-2xl border border-zinc-200/90 bg-white p-10 text-sm text-zinc-600 dark:border-zinc-800/90 dark:bg-zinc-900/40 dark:text-zinc-400">
				<Loader2 className="h-4 w-4 animate-spin" aria-hidden />
				검색 인덱스 불러오는 중…
			</div>
		);
	}

	if (error) {
		return (
			<div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
				<p className="font-semibold">검색을 시작할 수 없습니다</p>
				<p className="mt-1">{error}</p>
				<p className="mt-2 text-xs opacity-80">
					빌드 후 <code className="rounded bg-red-100 px-1 dark:bg-red-900/40">/search-index.json</code>이
					생성되는지 확인하세요.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-2xl border border-zinc-200/90 bg-white p-5 shadow-sm dark:border-zinc-800/90 dark:bg-zinc-900/40">
			<label className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
				<Search className="h-4 w-4 text-zinc-500" aria-hidden />
				<span>키워드 검색</span>
			</label>
			<input
				type="search"
				value={query}
				onChange={(e) => {
					setQuery(e.target.value);
					resetPage();
				}}
				placeholder="제목, 태그, 요약에서 검색…"
				className="mt-3 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-violet-500/30 transition placeholder:text-zinc-400 focus:border-violet-400 focus:bg-white focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/60 dark:focus:bg-zinc-900"
				autoComplete="off"
			/>

			<div className="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					className={toggleChipClass(effectiveSort === 'relevance')}
					onClick={() => {
						setSortMode('relevance');
						resetPage();
					}}
					disabled={tokens.length === 0}
					aria-pressed={effectiveSort === 'relevance'}
				>
					정확도순
				</button>
				<button
					type="button"
					className={toggleChipClass(effectiveSort === 'date')}
					onClick={() => {
						setSortMode('date');
						resetPage();
					}}
					aria-pressed={effectiveSort === 'date'}
				>
					최신 날짜순
				</button>
			</div>

			<div className="mt-4">
				<p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">플랫폼</p>
				<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
					{(Object.keys(PLATFORM_LABELS) as PlatformFilter[]).map((p) => (
						<button
							key={p}
							type="button"
							className={chipClass(platforms.has(p))}
							onClick={() => togglePlatform(p)}
							aria-pressed={platforms.has(p)}
						>
							{PLATFORM_LABELS[p]}
						</button>
					))}
					{platforms.size > 0 && (
						<button
							type="button"
							className="px-1 text-xs font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
							onClick={() => {
								setPlatforms(new Set());
								resetPage();
							}}
						>
							필터 초기화
						</button>
					)}
				</div>
			</div>

			<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-zinc-500 dark:text-zinc-500">
					{results.length === 0
						? '0건'
						: `${results.length}건 중 ${rangeStart}–${rangeEnd}`}{' '}
					· /search-index.json 기준
					{tokens.length === 0 ? ' · 검색어 없을 때는 최신 날짜순' : ''}
				</p>
				<label className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-300">
					<span className="sr-only">결과 표시</span>
					<select
						value={pageSize}
						onChange={(e) => selectPageSize(Number(e.target.value) as PageSize)}
						className="rounded-lg border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/30 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
						aria-label="결과 표시 개수"
					>
						{PAGE_SIZES.map((size) => (
							<option key={size} value={size}>
								{size}개씩
							</option>
						))}
					</select>
				</label>
			</div>

			<ul className="mt-4 divide-y divide-zinc-100 rounded-xl border border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800/80">
				{results.length === 0 ? (
					<li className="px-3 py-6 text-center text-sm text-zinc-500">조건에 맞는 항목이 없습니다.</li>
				) : (
					visible.map((row) => (
						<li key={row.id} className="px-3 py-2.5">
							<div className="flex items-center justify-between gap-2 text-[11px] text-zinc-500">
								<span>{kindLabel(row)}</span>
								<span>{formatShort(row.publishedAt)}</span>
							</div>
							<a
								href={row.url}
								target="_blank"
								rel="noopener noreferrer"
								className="mt-0.5 block text-sm font-semibold text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
							>
								{row.title}
							</a>
							{row.summary && (
								<p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">{row.summary}</p>
							)}
						</li>
					))
				)}
			</ul>

			{pageCount > 1 && (
				<nav className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="검색 결과 페이지">
					<button
						type="button"
						className="rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:disabled:text-zinc-600"
						onClick={() => setPage(current - 1)}
						disabled={current <= 1}
					>
						이전
					</button>
					{pages.map((entry, index) =>
						typeof entry === 'object' ? (
							<button
								key={`jump-${index}`}
								type="button"
								className="rounded-lg px-1.5 py-1 text-xs font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
								onClick={() => setPage(entry.jumpTo)}
								aria-label={`${entry.jumpTo}페이지로 이동`}
							>
								…
							</button>
						) : (
							<button
								key={entry}
								type="button"
								className={[
									'min-w-8 rounded-lg px-2 py-1 text-xs font-medium transition',
									entry === current
										? 'bg-violet-600 text-white dark:bg-violet-500'
										: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700',
								].join(' ')}
								onClick={() => setPage(entry)}
								aria-current={entry === current ? 'page' : undefined}
							>
								{entry}
							</button>
						),
					)}
					<button
						type="button"
						className="rounded-lg px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-300 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:disabled:text-zinc-600"
						onClick={() => setPage(current + 1)}
						disabled={current >= pageCount}
					>
						다음
					</button>
				</nav>
			)}
		</div>
	);
}
