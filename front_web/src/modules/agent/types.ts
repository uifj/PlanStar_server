export interface TripPlannerMessage {
	chatId?: string;
	message: string;
}

export interface TripPlannerReply {
	chatId: string;
	snapshotId?: string;
	reply: string;
}

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
	id: string;
	role: ChatRole;
	text: string;
}
