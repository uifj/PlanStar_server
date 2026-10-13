import { useTranslation } from "@/shared/i18n";
import type { ChatMessage as ChatMessageType } from "../types";

export function ChatMessage({ message }: { message: ChatMessageType }) {
	const { t } = useTranslation();
	const isUser = message.role === "user";

	return (
		<div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
			<div
				className={`max-w-[85%] rounded-xl px-4 py-3 shadow-sm sm:max-w-[70%] ${
					isUser
						? "bg-primary text-card"
						: "border border-border bg-card text-foreground"
				}`}
			>
				<p className="mb-1 font-bold text-xs uppercase tracking-wide opacity-70">
					{isUser ? t("agent.you") : t("agent.assistant")}
				</p>
				<p className="whitespace-pre-wrap font-medium text-sm leading-6">
					{message.text}
				</p>
			</div>
		</div>
	);
}
