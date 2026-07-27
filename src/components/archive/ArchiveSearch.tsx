import Fuse from 'fuse.js';
import { Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { SearchIndexRow } from '../../lib/types';

type SortMode = 'relevance' | 'date';
type PlatformFilter = 'youtube' | 'tistory' | 'naver';
type CategoryFilter = 'game-analysis' | 'mobile-review' | 'visual-poem';

const PLATFORM_LABELS: Record<PlatformFilter, string> = {
	youtube: 'YouTube',
	tistory: 'Tistory',
	naver: 'Naver',
};

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
	'game-analysis': 'Game Analysis',
	'mobile-review': 'Mobile Review',
	'visual-poem': 'Visual Poem',
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

export default function ArchiveSearch() {
	const [items, setItems] = useState<SearchIndexRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const [sortMode, setSortMode] = useState<SortMode>('relevance');
	const [platforms, setPlatforms] = useState<Set<PlatformFilter>>(new Set());
	const [categories, setCategories] = useState<Set<CategoryFilter>>(new Set());
	const [tags, setTags] = useState<Set<string>>(new Set());

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

	const fuse = useMemo(
		() =>
			new Fuse(items, {
				keys: [
					{ name: 'title', weight: 0.55 },
					{ name: 'tags', weight: 0.25 },
					{ name: 'summary', weight: 0.15 },
					{ name: 'platform', weight: 0.03 },
					{ name: 'category', weight: 0.02 },
				],
				threshold: 0.32,
				ignoreLocation: true,
			}),
		[items],
	);

	const availableTags = useMemo(() => {
		const counts = new Map<string, number>();
		for (const item of items) {
			for (const tag of item.tags) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
			.map(([tag]) => tag);
	}, [items]);

	const filtered = useMemo(() => {
		let rows = items;

		if (platforms.size > 0) {
			rows = rows.filter((row) => {
				if (row.kind === 'youtube') return platforms.has('youtube');
				if (row.platform === 'tistory') return platforms.has('tistory');
				if (row.platform === 'naver') return platforms.has('naver');
				return false;
			});
		}

		if (categories.size > 0) {
			rows = rows.filter((row) => row.category && categories.has(row.category));
		}

		if (tags.size > 0) {
			rows = rows.filter((row) => row.tags.some((t) => tags.has(t)));
		}

		return rows;
	}, [items, platforms, categories, tags]);

	const results = useMemo(() => {
		const q = query.trim();
		let rows: SearchIndexRow[];

		if (!q) {
			rows = filtered;
		} else {
			const allowed = new Set(filtered.map((r) => r.id));
			rows = fuse
				.search(q)
				.map((r) => r.item)
				.filter((row) => allowed.has(row.id));
		}

		const effectiveSort: SortMode = q ? sortMode : 'date';
		if (effectiveSort === 'date') return sortByDate(rows);
		return rows;
	}, [query, filtered, fuse, sortMode]);

	const effectiveSort: SortMode = query.trim() ? sortMode : 'date';

	function togglePlatform(p: PlatformFilter) {
		setPlatforms((prev) => {
			const next = new Set(prev);
			if (next.has(p)) next.delete(p);
			else next.add(p);
			return next;
		});
	}

	function toggleCategory(c: CategoryFilter) {
		setCategories((prev) => {
			const next = new Set(prev);
			if (next.has(c)) next.delete(c);
			else next.add(c);
			return next;
		});
	}

	function toggleTag(tag: string) {
		setTags((prev) => {
			const next = new Set(prev);
			if (next.has(tag)) next.delete(tag);
			else next.add(tag);
			return next;
		});
	}

	function clearFilters() {
		setPlatforms(new Set());
		setCategories(new Set());
		setTags(new Set());
	}

	const hasActiveFilters = platforms.size > 0 || categories.size > 0 || tags.size > 0;

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
				onChange={(e) => setQuery(e.target.value)}
				placeholder="제목, 태그, 요약에서 검색…"
				className="mt-3 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-sm text-zinc-900 outline-none ring-violet-500/30 transition placeholder:text-zinc-400 focus:border-violet-400 focus:bg-white focus:ring-4 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:placeholder:text-zinc-500 dark:focus:border-violet-500/60 dark:focus:bg-zinc-900"
				autoComplete="off"
			/>

			<div className="mt-3 flex flex-wrap gap-2">
				<button
					type="button"
					className={toggleChipClass(effectiveSort === 'relevance')}
					onClick={() => setSortMode('relevance')}
					disabled={!query.trim()}
					aria-pressed={effectiveSort === 'relevance'}
				>
					정확도순
				</button>
				<button
					type="button"
					className={toggleChipClass(effectiveSort === 'date')}
					onClick={() => setSortMode('date')}
					aria-pressed={effectiveSort === 'date'}
				>
					최신 날짜순
				</button>
			</div>

			<div className="mt-4 space-y-3">
				<div>
					<p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">플랫폼</p>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
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
					</div>
				</div>

				<div>
					<p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">유튜브 카테고리</p>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						{(Object.keys(CATEGORY_LABELS) as CategoryFilter[]).map((c) => (
							<button
								key={c}
								type="button"
								className={chipClass(categories.has(c))}
								onClick={() => toggleCategory(c)}
								aria-pressed={categories.has(c)}
							>
								{CATEGORY_LABELS[c]}
							</button>
						))}
					</div>
				</div>

				{availableTags.length > 0 && (
					<div>
						<p className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">태그</p>
						<div className="mt-1.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
							{availableTags.map((tag) => (
								<button
									key={tag}
									type="button"
									className={chipClass(tags.has(tag))}
									onClick={() => toggleTag(tag)}
									aria-pressed={tags.has(tag)}
								>
									#{tag}
								</button>
							))}
						</div>
					</div>
				)}

				{hasActiveFilters && (
					<button
						type="button"
						className="text-xs font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
						onClick={clearFilters}
					>
						필터 초기화
					</button>
				)}
			</div>

			<p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
				{results.length}건 표시 · /search-index.json 기준
				{query.trim() ? '' : ' · 검색어 없을 때는 최신 날짜순'}
			</p>

			<ul className="mt-4 max-h-80 divide-y divide-zinc-100 overflow-y-auto rounded-xl border border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800/80">
				{results.length === 0 ? (
					<li className="px-3 py-6 text-center text-sm text-zinc-500">조건에 맞는 항목이 없습니다.</li>
				) : (
					results.map((row) => (
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
		</div>
	);
}
