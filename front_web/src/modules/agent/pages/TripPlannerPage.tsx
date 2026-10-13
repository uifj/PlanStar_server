import { Button } from "@/components/ui/button";
import { Alert } from "@/shared/components/Alert";
import { EmptyState } from "@/shared/components/EmptyState";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { ChatInput } from "../components/ChatInput";
import { ChatMessage } from "../components/ChatMessage";
import { useTripPlanner } from "../hooks/useTripPlanner";

export default function TripPlannerPage() {
	const { t } = useTranslation();
	const { messages, isSending, errorStatus, send, reset } = useTripPlanner();

	const errorMessage =
		errorStatus === null
			? null
			: errorStatus === 503
				? t("agent.unavailable")
				: t("agent.error");

	return (
		<section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
			<PageHeader
				eyebrow={t("nav.tripPlanner")}
				title={t("agent.subtitle")}
				aside={
					messages.length > 0 ? (
						<Button type="button" variant="ghost" onClick={reset}>
							{t("agent.newChat")}
						</Button>
					) : null
				}
			/>

			<div className="overflow-hidden rounded-xl border border-border bg-secondary shadow-sm">
				<div className="flex min-h-96 flex-col justify-end gap-4 p-4 sm:p-6">
					{messages.length === 0 ? (
						<EmptyState title={t("agent.title")} message={t("agent.empty")} />
					) : (
						<div className="flex flex-col gap-4">
							{messages.map((message) => (
								<ChatMessage key={message.id} message={message} />
							))}

							{isSending && (
								<div className="flex justify-start">
									<div className="rounded-xl border border-border bg-card px-4 py-3 font-medium text-muted-foreground text-sm">
										{t("agent.sending")}
									</div>
								</div>
							)}
						</div>
					)}
				</div>

				<div className="border-border border-t p-4 sm:p-6">
					{errorMessage ? (
						<div className="mb-4">
							<Alert variant="error">{errorMessage}</Alert>
						</div>
					) : null}

					<ChatInput onSend={send} disabled={isSending} />
				</div>
			</div>
		</section>
	);
}
