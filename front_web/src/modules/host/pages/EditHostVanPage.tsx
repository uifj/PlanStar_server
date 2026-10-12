import { useNavigate, useParams } from "react-router";
import { BackButton } from "@/shared/components/BackButton";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { useVan } from "@/shared/domain/vans/hooks/useVan";
import { HostVanForm } from "../components/HostVanForm";
import { useUpdateHostVan } from "../hooks/useUpdateHostVan";
import type { CreateHostVanRequest } from "../types";

export default function EditHostVanPage() {
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
				title="Van not found"
				message="This van may not exist, or it may not belong to your host account."
			/>
		);
	}

	return (
		<section>
			<BackButton to=".." className="mb-8 text-muted hover:text-clay" />

			<div className="mx-auto max-w-4xl">
				<PageHeader
					eyebrow="Edit van"
					title={`Update ${van.name}.`}
					className="mb-8"
				/>

				<div className="rounded-xl bg-surface p-5 shadow-sm md:p-8">
					<p className="mb-6 max-w-2xl font-medium text-muted leading-7">
						Keep this listing accurate for guests. Changes update the active van
						details used across browsing and host inventory.
					</p>

					<HostVanForm
						initialVan={van}
						submitLabel="Save changes"
						loading={updateLoading}
						error={updateError}
						successMessage={success ? "Van updated." : ""}
						onSubmit={handleSubmit}
					/>
				</div>
			</div>
		</section>
	);
}
