import { en as bookingsEn, zh as bookingsZh } from "./bookings";
import { en as commonEn, zh as commonZh } from "./common";
import { en as hostEn, zh as hostZh } from "./host";
import { en as vansEn, zh as vansZh } from "./vans";

export const en = { ...commonEn, ...vansEn, ...bookingsEn, ...hostEn };
export const zh: typeof en = {
	...commonZh,
	...vansZh,
	...bookingsZh,
	...hostZh,
};

export type TranslationDict = typeof en;

export const translations = { en, zh } as const;
