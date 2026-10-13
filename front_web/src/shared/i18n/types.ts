export type Language = "en" | "zh";

export const LANGUAGES: Language[] = ["en", "zh"];

export const LANGUAGE_LABELS: Record<Language, string> = {
	en: "English",
	zh: "中文",
};

export const LANGUAGE_LOCALES: Record<Language, string> = {
	en: "en-US",
	zh: "zh-CN",
};
