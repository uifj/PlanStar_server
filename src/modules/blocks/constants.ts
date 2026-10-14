import type { ObjectLayout } from "../../generated/prisma/enums.js";

export const BLOCK_TYPES = ["text", "link"] as const;

export const BLOCK_STYLES = [
	"paragraph",
	"heading1",
	"heading2",
	"heading3",
	"quote",
	"code",
	"bulleted",
	"numbered",
	"toggle",
] as const;

// Only a page body holds blocks (ADR-0013); mirrors and saved views do not.
export const DOCUMENT_LAYOUTS: readonly ObjectLayout[] = ["basic"];

export const BLOCK_LINK_RELATION = "links";
