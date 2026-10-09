// 서버가 어느 나라 시간대든 한국 시간으로 보여줍니다.
export function formatDateTime(d: Date): string {
	return d.toLocaleString('ko-KR', {
		timeZone: 'Asia/Seoul',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	});
}

export function formatDate(d: Date): string {
	return d.toLocaleDateString('ko-KR', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}
