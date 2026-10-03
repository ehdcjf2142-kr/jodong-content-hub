import { useMemo, useState } from 'react';
import type { FeedItem } from '../../lib/types';

const PAGE_SIZES = [10, 30, 50] as const;
type PageSize = (typeof PAGE_SIZES)[number];

interface Props {
	items: FeedItem[];
}

function formatPublished(value: Date | string): string {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleDateString('ko-KR', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

function kindLabel(item: FeedItem): string {
	if (item.kind === 'youtube') return 'YouTube';
	if (item.platform === 'tistory') return 'Tistory';
	return 'Naver';
}

const PAGE_JUMP = 5;

type PageSlot = number | { jumpTo: number };

function pageWindow(current: number, total: number): PageSlot[] {
	if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

	const shown = new Set<number>([1, total]);
	for (let page = current - 2; page <= current + 2; page++) {
		if (page >= 1 && page <= total) shown.add(page);
	}

	const sorted = [...shown].sort((a, b) => a - b);
	const items: PageSlot[] = [];
	for (let index = 0; index < sorted.length; index++) {
		const page = sorted[index];
		const previous = sorted[index - 1];
		if (index > 0 && page - previous > 1) {
			const toward = page < current ? current - PAGE_JUMP : current + PAGE_JUMP;
			const jumpTo = Math.min(page - 1, Math.max(previous + 1, toward));
			items.push({ jumpTo });
		}
		items.push(page);
	}
	return items;
}

export default function DataMapTable({ items }: Props) {
	const [pageSize, setPageSize] = useState<PageSize>(10);
	const [page, setPage] = useState(1);

	const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
	const current = Math.min(page, pageCount);
	const startIndex = (current - 1) * pageSize;
	const visible = items.slice(startIndex, startIndex + pageSize);
	const pages = useMemo(() => pageWindow(current, pageCount), [current, pageCount]);
	const rangeStart = items.length === 0 ? 0 : startIndex + 1;
	const rangeEnd = startIndex + visible.length;

	function selectPageSize(size: PageSize) {
		setPageSize(size);
		setPage(1);
	}

	return (
		<div>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap gap-1.5" role="group" aria-label="페이지당 개수">
					{PAGE_SIZES.map((size) => (
						<button
							key={size}
							type="button"
							className={[
								'rounded-lg px-2.5 py-1 text-xs font-medium transition',
								pageSize === size
									? 'bg-violet-600 text-white dark:bg-violet-500'
									: 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700',
							].join(' ')}
							onClick={() => selectPageSize(size)}
							aria-pressed={pageSize === size}
						>
							{size}개씩 보기
						</button>
					))}
				</div>
				<p className="text-xs text-zinc-500">
					{rangeStart}–{rangeEnd} / {items.length}
				</p>
			</div>

			<div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white dark:border-zinc-800/90 dark:bg-zinc-900/30">
				<div className="hidden lg:block">
					<table className="w-full text-left text-sm">
						<thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-400">
							<tr>
								<th className="px-4 py-3">날짜</th>
								<th className="px-4 py-3">플랫폼</th>
								<th className="px-4 py-3">제목</th>
								<th className="px-4 py-3">태그</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
							{visible.map((item) => (
								<tr key={item.id} className="transition hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40">
									<td className="whitespace-nowrap px-4 py-3 text-zinc-500">
										{formatPublished(item.publishedAt)}
									</td>
									<td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-700 dark:text-zinc-300">
										{kindLabel(item)}
									</td>
									<td className="px-4 py-3">
										<a
											href={item.url}
											target="_blank"
											rel="noopener noreferrer"
											className="font-medium text-violet-700 underline-offset-2 hover:underline dark:text-violet-300"
										>
											{item.title}
										</a>
									</td>
									<td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
										{item.tags.join(', ')}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<ul className="divide-y divide-zinc-100 lg:hidden dark:divide-zinc-800/80">
					{visible.map((item) => (
						<li key={item.id} className="p-4">
							<div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
								<span>{kindLabel(item)}</span>
								<span>{formatPublished(item.publishedAt)}</span>
							</div>
							<a
								href={item.url}
								target="_blank"
								rel="noopener noreferrer"
								className="mt-2 block text-sm font-semibold text-zinc-900 dark:text-zinc-50"
							>
								{item.title}
							</a>
							{item.tags.length > 0 && (
								<p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{item.tags.join(' · ')}</p>
							)}
						</li>
					))}
				</ul>
			</div>

			{pageCount > 1 && (
				<nav className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="데이터 맵 페이지">
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
