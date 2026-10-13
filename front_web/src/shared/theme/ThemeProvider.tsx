import {
	createContext,
	type PropsWithChildren,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";

const STORAGE_KEY = "vanlife-theme";

export type Theme = "light" | "dark";

type ThemeContextValue = {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getInitialTheme(): Theme {
	if (typeof window === "undefined") {
		return "light";
	}

	const stored = localStorage.getItem(STORAGE_KEY);

	if (stored === "light" || stored === "dark") {
		return stored;
	}

	return window.matchMedia("(prefers-color-scheme: dark)").matches
		? "dark"
		: "light";
}

export function ThemeProvider({ children }: PropsWithChildren) {
	const [theme, setThemeState] = useState<Theme>(getInitialTheme);

	useEffect(() => {
		const root = document.documentElement;
		root.classList.toggle("dark", theme === "dark");
		root.style.colorScheme = theme;
	}, [theme]);

	const setTheme = useCallback((next: Theme) => {
		setThemeState(next);
		localStorage.setItem(STORAGE_KEY, next);
	}, []);

	const toggleTheme = useCallback(() => {
		setThemeState((prev) => {
			const next = prev === "dark" ? "light" : "dark";
			localStorage.setItem(STORAGE_KEY, next);
			return next;
		});
	}, []);

	const value = useMemo(
		() => ({ theme, setTheme, toggleTheme }),
		[theme, setTheme, toggleTheme],
	);

	return (
		<ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
	);
}

export function useTheme() {
	const context = useContext(ThemeContext);

	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}

	return context;
}
