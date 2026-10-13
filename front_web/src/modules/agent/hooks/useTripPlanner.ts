import { useCallback, useState } from "react";
import { isApiError } from "@/shared/api/apiError";
import { sendTripPlannerMessage } from "../services/agentService";
import type { ChatMessage } from "../types";

export function useTripPlanner() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [chatId, setChatId] = useState<string | null>(null);
	const [isSending, setIsSending] = useState(false);
	const [errorStatus, setErrorStatus] = useState<number | null>(null);

	const send = useCallback(
		async (text: string) => {
			const trimmed = text.trim();

			if (!trimmed || isSending) {
				return;
			}

			const userMessage: ChatMessage = {
				id: crypto.randomUUID(),
				role: "user",
				text: trimmed,
			};

			setMessages((prev) => [...prev, userMessage]);
			setErrorStatus(null);
			setIsSending(true);

			try {
				const reply = await sendTripPlannerMessage({
					chatId: chatId ?? undefined,
					message: trimmed,
				});

				setChatId(reply.chatId);
				setMessages((prev) => [
					...prev,
					{ id: crypto.randomUUID(), role: "assistant", text: reply.reply },
				]);
			} catch (err) {
				setErrorStatus(isApiError(err) ? (err.status ?? 0) : 0);
			} finally {
				setIsSending(false);
			}
		},
		[chatId, isSending],
	);

	const reset = useCallback(() => {
		setMessages([]);
		setChatId(null);
		setErrorStatus(null);
	}, []);

	return { messages, chatId, isSending, errorStatus, send, reset };
}
