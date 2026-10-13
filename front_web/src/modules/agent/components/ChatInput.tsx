import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/shared/i18n";

interface ChatInputProps {
	onSend: (text: string) => void;
	disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
	const { t } = useTranslation();
	const [value, setValue] = useState("");

	function handleSubmit(event: FormEvent) {
		event.preventDefault();

		const trimmed = value.trim();

		if (!trimmed || disabled) {
			return;
		}

		onSend(trimmed);
		setValue("");
	}

	return (
		<form onSubmit={handleSubmit} className="flex items-center gap-3">
			<Input
				type="text"
				value={value}
				onChange={(event) => setValue(event.target.value)}
				placeholder={t("agent.placeholder")}
				disabled={disabled}
				className="flex-1"
			/>
			<Button type="submit" disabled={disabled || !value.trim()}>
				{disabled ? t("agent.sending") : t("agent.send")}
			</Button>
		</form>
	);
}
