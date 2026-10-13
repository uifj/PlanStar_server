import { useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { useObjects } from "../hooks/useObjects";
import type { ObjectsQueryParams } from "../types";

const budgetAbove100: ObjectsQueryParams = {
	filters: [{ key: "budget", operator: "greater", value: 100 }],
	sort: "budget",
	order: "desc",
};

export default function ObjectSlicePage() {
	const { t } = useTranslation();
	const [searchParams] = useSearchParams();
	const spaceId = searchParams.get("spaceId");

	const { loading, error, objects, meta, refetch } = useObjects({
		spaceId: spaceId ?? undefined,
		query: budgetAbove100,
	});

	if (!spaceId) {
		return (
			<div className="mx-auto max-w-4xl px-6 py-16">
				<EmptyState
					title={t("objects.devTitle")}
					message={t("objects.needsSpace")}
				/>
			</div>
		);
	}

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage message={error.message} onRetry={refetch} />;
	}

	return (
		<section className="mx-auto max-w-4xl px-6 py-16">
			<PageHeader
				eyebrow={t("objects.devEyebrow")}
				title={t("objects.devTitle")}
				aside={
					meta ? (
						<span className="font-medium text-muted-foreground text-sm">
							{t("objects.total", { count: meta.total })}
						</span>
					) : null
				}
			/>

			<p className="mt-4 font-medium text-muted-foreground text-sm">
				{t("objects.devDescription")}
			</p>

			{objects.length === 0 ? (
				<div className="mt-10">
					<EmptyState
						title={t("objects.devTitle")}
						message={t("objects.empty")}
					/>
				</div>
			) : (
				<ul className="mt-10 divide-y divide-border rounded-xl border border-border bg-card">
					{objects.map((object) => (
						<li
							key={object.id}
							className="flex items-center justify-between gap-4 px-6 py-4"
						>
							<span className="font-semibold text-foreground">
								{object.name}
							</span>
							<Badge variant="secondary">
								{t("objects.budget")}: {String(object.details.budget)}
							</Badge>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
