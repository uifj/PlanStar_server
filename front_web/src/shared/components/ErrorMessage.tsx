import { FaTriangleExclamation } from "react-icons/fa6";
import { cn } from "tailwind-variants";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/shared/i18n";

interface ErrorMessageProps {
	title?: string;
	message?: string;
	onRetry?: () => void;
	className?: string;
}

export default function ErrorMessage({
	title,
	message,
	onRetry,
	className,
}: ErrorMessageProps) {
	const { t } = useTranslation();

	return (
		<div
			role="alert"
			aria-live="assertive"
			className={cn(
				"mx-auto flex min-h-96 max-w-7xl items-center justify-center px-6",
				className,
			)}
		>
			<div className="flex max-w-md flex-col items-center text-center">
				<FaTriangleExclamation
					aria-hidden="true"
					className="mb-6 text-5xl text-primary"
				/>

				<h2 className="mb-3 font-black text-3xl text-foreground">
					{title ?? t("common.errorTitle")}
				</h2>

				<p className="mb-8 font-medium text-base text-muted-foreground leading-7">
					{message ?? t("common.errorMessage")}
				</p>

				{onRetry && (
					<Button type="button" onClick={onRetry}>
						{t("common.retry")}
					</Button>
				)}
			</div>
		</div>
	);
}
