import { useNavigate } from "react-router";
import { BackButton } from "@/shared/components/BackButton";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { HostVanForm } from "../components/HostVanForm";
import { useCreateHostVan } from "../hooks/useCreateHostVan";
import type { CreateHostVanRequest } from "../types";

export default function CreateHostVanPage() {
	const { t } = useTranslation();
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
			<BackButton
				to=".."
				className="mb-8 text-muted-foreground hover:text-primary"
			/>

			<div className="mx-auto max-w-4xl">
				<PageHeader
					eyebrow={t("host.vans.add")}
					title={t("host.create.title")}
					className="mb-8"
				/>

				<div className="rounded-xl bg-card p-5 shadow-sm md:p-8">
					<p className="mb-6 max-w-2xl font-medium text-muted-foreground leading-7">
						{t("host.create.description")}
					</p>

					<HostVanForm
						submitLabel={t("host.create.submit")}
						loading={loading}
						error={error}
						successMessage={success ? t("host.create.success") : ""}
						onSubmit={handleSubmit}
					/>
				</div>
			</div>
		</section>
	);
}
