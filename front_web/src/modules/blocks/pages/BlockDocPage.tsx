import { useSearchParams } from "react-router";
import { EmptyState } from "@/shared/components/EmptyState";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { BlockDocument } from "../components/BlockDocument";

export default function BlockDocPage() {
	const { t } = useTranslation();
	const [searchParams] = useSearchParams();
	const objectId = searchParams.get("objectId");

	if (!objectId) {
		return (
			<div className="mx-auto max-w-4xl px-6 py-16">
				<EmptyState
					title={t("blocks.devTitle")}
					message={t("blocks.needsObject")}
				/>
			</div>
		);
	}

	return (
		<section className="mx-auto max-w-4xl px-6 py-16">
			<PageHeader
				eyebrow={t("blocks.devEyebrow")}
				title={t("blocks.devTitle")}
			/>

			<p className="mt-4 font-medium text-muted-foreground text-sm">
				{t("blocks.devDescription")}
			</p>

			<div className="mt-10">
				<BlockDocument objectId={objectId} />
			</div>
		</section>
	);
}
