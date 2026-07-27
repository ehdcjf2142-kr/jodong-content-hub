import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'theme';

function readDark(): boolean {
	if (typeof document === 'undefined') return false;
	return document.documentElement.classList.contains('dark');
}

export default function ThemeToggle() {
	const [dark, setDark] = useState(false);

	useEffect(() => {
		setDark(readDark());
	}, []);

	const toggle = () => {
		const next = !document.documentElement.classList.contains('dark');
		document.documentElement.classList.toggle('dark', next);
		localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
		setDark(next);
	};

	return (
		<button
			type="button"
			onClick={toggle}
			className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:border-violet-300 hover:text-violet-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-violet-500/50 dark:hover:text-violet-200"
			aria-label={dark ? '라이트 모드로 전환' : '다크 모드로 전환'}
		>
			{dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
		</button>
	);
}
