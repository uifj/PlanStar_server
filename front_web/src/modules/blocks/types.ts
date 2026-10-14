export const blockTypes = ["text", "link"] as const;

export const blockStyles = [
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

export type BlockType = (typeof blockTypes)[number];
export type BlockStyle = (typeof blockStyles)[number];

export interface DocumentBlock {
	id: string;
	objectId: string;
	parentId: string | null;
	type: BlockType;
	style: BlockStyle;
	text: string;
	linkTargetId: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface BlockListResponse {
	data: DocumentBlock[];
}

export interface UpdateBlockInput {
	text?: string;
	style?: BlockStyle;
	parentId?: string | null;
	afterBlockId?: string | null;
}
