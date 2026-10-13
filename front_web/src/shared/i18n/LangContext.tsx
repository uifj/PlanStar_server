import {
	createContext,
	type PropsWithChildren,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import { translations } from "./translations";
import type { Language } from "./types";

const STORAGE_KEY = "vanlife-language";

export type TranslateParams = Record<string, string | number>;

type LangContextValue = {
	language: Language;
	setLanguage: (language: Language) => void;
	t: (key: string, params?: TranslateParams) => string;
};

const LangContext = createContext<LangContextValue | null>(null);

function detectInitialLanguage(): Language {
	const stored = localStorage.getItem(STORAGE_KEY);

	if (stored === "en" || stored === "zh") {
		return stored;
	}

	return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

function resolveKey(dict: object, key: string): unknown {
	return key.split(".").reduce<unknown>((acc, part) => {
		if (acc && typeof acc === "object") {
			return (acc as Record<string, unknown>)[part];
		}

		return undefined;
	}, dict);
}

function translate(
	dict: object,
	key: string,
	params?: TranslateParams,
): string {
	const value = resolveKey(dict, key);

	if (typeof value !== "string") {
		return key;
	}

	if (!params) {
		return value;
	}

	return value.replace(/\{(\w+)\}/g, (_, name: string) =>
		String(params[name] ?? `{${name}}`),
	);
}

export function LangProvider({ children }: PropsWithChildren) {
	const [language, setLanguageState] = useState<Language>(
		detectInitialLanguage,
	);

	const setLanguage = useCallback((next: Language) => {
		setLanguageState(next);
		localStorage.setItem(STORAGE_KEY, next);
	}, []);

	const t = useCallback(
		(key: string, params?: TranslateParams) =>
			translate(translations[language], key, params),
		[language],
	);

	const value = useMemo(
		() => ({ language, setLanguage, t }),
		[language, setLanguage, t],
	);

	return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useTranslation() {
	const context = useContext(LangContext);

	if (!context) {
		throw new Error("useTranslation must be used within a LangProvider");
	}

	return context;
}
