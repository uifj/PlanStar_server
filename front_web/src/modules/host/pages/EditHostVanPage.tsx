import { useNavigate, useParams } from "react-router";
import { BackButton } from "@/shared/components/BackButton";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { useVan } from "@/shared/domain/vans/hooks/useVan";
import { useTranslation } from "@/shared/i18n";
import { HostVanForm } from "../components/HostVanForm";
import { useUpdateHostVan } from "../hooks/useUpdateHostVan";
import type { CreateHostVanRequest } from "../types";

export default function EditHostVanPage() {
	const { t } = useTranslation();
	const { id } = useParams();
	const navigate = useNavigate();
	const { van, loading, error, refetch } = useVan(id, { isHost: true });
	const {
		updateVan,
		loading: updateLoading,
		error: updateError,
		success,
	} = useUpdateHostVan();

	function handleSubmit(vanFormData: CreateHostVanRequest) {
		if (!id) {
			return;
		}

		updateVan(
			{
				id,
				...vanFormData,
			},
			{
				onSuccess: () => {
					navigate(`../${id}`, { replace: true });
				},
			},
		);
	}

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	if (!van) {
		return (
			<EmptyState
				title={t("host.van.notFoundTitle")}
				message={t("host.van.notFoundMessage")}
			/>
		);
	}

	return (
		<section>
			<BackButton
				to=".."
				className="mb-8 text-muted-foreground hover:text-primary"
			/>

			<div className="mx-auto max-w-4xl">
				<PageHeader
					eyebrow={t("host.van.edit")}
					title={t("host.edit.title", { name: van.name })}
					className="mb-8"
				/>

				<div className="rounded-xl bg-card p-5 shadow-sm md:p-8">
					<p className="mb-6 max-w-2xl font-medium text-muted-foreground leading-7">
						{t("host.edit.description")}
					</p>

					<HostVanForm
						initialVan={van}
						submitLabel={t("host.edit.submit")}
						loading={updateLoading}
						error={updateError}
						successMessage={success ? t("host.edit.success") : ""}
						onSubmit={handleSubmit}
					/>
				</div>
			</div>
		</section>
	);
}
