import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/shared/i18n";
import type { VanType } from "../types";

const typeStyles: Record<VanType, string> = {
	simple: "bg-primary text-card hover:bg-primary",
	luxury: "bg-foreground text-card hover:bg-foreground",
	rugged: "bg-sage text-card hover:bg-sage",
};

interface VanTypeBadgeProps {
	type: VanType;
	className?: string;
}

export default function VanTypeBadge({ type, className }: VanTypeBadgeProps) {
	const { t } = useTranslation();

	return (
		<Badge
			className={cn(
				"shrink-0 rounded-md px-3 py-1 text-sm capitalize",
				typeStyles[type],
				className,
			)}
		>
			{t(`vans.type.${type}`)}
		</Badge>
	);
}
