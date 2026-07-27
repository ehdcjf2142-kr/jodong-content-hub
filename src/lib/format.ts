export function formatDate(d: Date): string {
	return d.toLocaleDateString('ko-KR', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}
