import { useState } from "react";
import { cn } from "tailwind-variants";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { DaysFilter } from "../components/DaysFilter";
import { IncomeChart } from "../components/IncomeChart";
import { TransactionCard } from "../components/TransactionCard";
import { useIncome } from "../hooks/useIncome";

export default function IncomePage() {
	const [days, setDays] = useState(30);
	const { income, loading, error, refetch } = useIncome({ days });

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	if (!income) {
		return null;
	}

	const hasMultipleTransactions = income.transactions.length > 1;

	return (
		<section>
			<PageHeader
				eyebrow="Host income"
				title="Income overview."
				aside={
					<div className="flex flex-col gap-3 md:items-end">
						<p className="font-medium text-muted">Last {income.days} days</p>
						<DaysFilter value={days} onChange={setDays} />
					</div>
				}
			/>

			<div className="grid gap-6 2xl:grid-cols-3">
				<section
					aria-labelledby="income-total"
					className="rounded-xl bg-surface p-6 shadow-sm 2xl:col-span-2"
				>
					<p className="font-semibold text-muted text-sm">Total income</p>
					<h2 id="income-total" className="mt-3 font-black text-5xl text-ink">
						${income.total.toLocaleString()}
					</h2>
					<IncomeChart periods={income.periods} />
				</section>

				<section aria-labelledby="transactions-title">
					<div className="mb-4 flex items-end justify-between gap-4">
						<h2
							id="transactions-title"
							className="font-black text-2xl text-ink"
						>
							Transactions
						</h2>
						<p className="font-medium text-muted text-sm">
							{income.transactions.length} paid
						</p>
					</div>

					{income.transactions.length > 0 ? (
						<div
							className={cn(
								"grid gap-3",
								hasMultipleTransactions
									? "md:grid-cols-2 2xl:grid-cols-1"
									: "sm:max-w-xl 2xl:max-w-none",
							)}
						>
							{income.transactions.map((transaction) => (
								<TransactionCard
									key={transaction.id}
									transaction={transaction}
								/>
							))}
						</div>
					) : (
						<EmptyState
							title="No transactions"
							message="Paid bookings will show up here after completed trips."
						/>
					)}
				</section>
			</div>
		</section>
	);
}
