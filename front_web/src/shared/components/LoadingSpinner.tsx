import { useTranslation } from "@/shared/i18n";

export default function LoadingSpinner() {
	const { t } = useTranslation();

	return (
		<div
			role="status"
			aria-live="polite"
			className="mx-auto flex min-h-96 max-w-7xl items-center justify-center px-6"
		>
			<div className="size-10 animate-spin rounded-full border-4 border-secondary border-t-primary" />
			<span className="sr-only">{t("common.loading")}</span>
		</div>
	);
}
