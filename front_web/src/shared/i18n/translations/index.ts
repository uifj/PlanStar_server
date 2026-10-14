import { en as blocksEn, zh as blocksZh } from "./blocks";
import { en as bookingsEn, zh as bookingsZh } from "./bookings";
import { en as commonEn, zh as commonZh } from "./common";
import { en as hostEn, zh as hostZh } from "./host";
import { en as objectsEn, zh as objectsZh } from "./objects";
import { en as spacesEn, zh as spacesZh } from "./spaces";
import { en as vansEn, zh as vansZh } from "./vans";

export const en = {
	...commonEn,
	...vansEn,
	...bookingsEn,
	...hostEn,
	...objectsEn,
	...blocksEn,
	...spacesEn,
};

export const zh: typeof en = {
	...commonZh,
	...vansZh,
	...bookingsZh,
	...hostZh,
	...objectsZh,
	...blocksZh,
	...spacesZh,
};

export type TranslationDict = typeof en;

export const translations = { en, zh } as const;
