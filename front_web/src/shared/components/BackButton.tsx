import { ArrowLeft } from "lucide-react";
import { Link, type To } from "react-router";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/shared/i18n";

interface BackButtonProps {
	text?: string;
	to: To;
	className?: string;
}

export function BackButton({ text, to, className }: BackButtonProps) {
	const { t } = useTranslation();

	return (
		<Link
			to={to}
			relative="path"
			className={cn(buttonVariants({ variant: "ghost" }), "px-0", className)}
		>
			<ArrowLeft aria-hidden="true" />
			{text ?? t("common.back")}
		</Link>
	);
}
