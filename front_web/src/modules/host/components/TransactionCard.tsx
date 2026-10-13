import VanTypeBadge from "@/shared/domain/vans/components/VanTypeBadge";
import { LANGUAGE_LOCALES, useTranslation } from "@/shared/i18n";
import type { Transaction } from "../types";
import { formatShortDate } from "../utils/formatStats";

interface TransactionCardProps {
	transaction: Transaction;
}

export function TransactionCard({ transaction }: TransactionCardProps) {
	const { language } = useTranslation();
	const locale = LANGUAGE_LOCALES[language];
	return (
		<article className="rounded-xl bg-card p-4 shadow-sm">
			<div className="flex items-center justify-between gap-4">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="truncate font-bold text-foreground">
							{transaction.van.name}
						</h3>
						<VanTypeBadge
							type={transaction.van.type}
							className="px-2 py-0.5 text-xs"
						/>
					</div>
					<p className="mt-1 font-medium text-muted-foreground text-sm">
						{formatShortDate(transaction.date, locale)}
					</p>
				</div>
				<p className="font-black text-foreground text-xl">
					${transaction.amount.toLocaleString()}
				</p>
			</div>
		</article>
	);
}
