import { useNavigate } from "react-router";
import { BackButton } from "@/shared/components/BackButton";
import { PageHeader } from "@/shared/components/PageHeader";
import { HostVanForm } from "../components/HostVanForm";
import { useCreateHostVan } from "../hooks/useCreateHostVan";
import type { CreateHostVanRequest } from "../types";

export default function CreateHostVanPage() {
	const navigate = useNavigate();
	const { createVan, loading, error, success } = useCreateHostVan();

	function handleSubmit(van: CreateHostVanRequest) {
		createVan(van, {
			onSuccess: (createdVan) => {
				navigate(`../${createdVan.id}`, {
					replace: true,
				});
			},
		});
	}

	return (
		<section>
			<BackButton to=".." className="mb-8 text-muted hover:text-clay" />

			<div className="mx-auto max-w-4xl">
				<PageHeader
					eyebrow="Add van"
					title="List a van for future trips."
					className="mb-8"
				/>

				<div className="rounded-xl bg-surface p-5 shadow-sm md:p-8">
					<p className="mb-6 max-w-2xl font-medium text-muted leading-7">
						Add the details guests need before they request a trip. You can edit
						these details later from your host inventory.
					</p>

					<HostVanForm
						submitLabel="Create van"
						loading={loading}
						error={error}
						successMessage={success ? "Van created." : ""}
						onSubmit={handleSubmit}
					/>
				</div>
			</div>
		</section>
	);
}
