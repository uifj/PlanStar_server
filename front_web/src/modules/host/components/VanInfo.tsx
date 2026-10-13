import type { VanDetail } from "@/shared/domain/vans/types";
import { useTranslation } from "@/shared/i18n";
import InfoRow from "./InfoRow";

interface VanInfoProps {
	van: VanDetail;
}

export default function VanInfo({ van }: VanInfoProps) {
	const { t } = useTranslation();

	return (
		<dl className="flex flex-col gap-5">
			<InfoRow label={t("host.van.name")} value={van.name} />
			<InfoRow label={t("host.van.location")} value={van.location} />
			<InfoRow label={t("host.van.rating")} value={van.rating.toFixed(1)} />
			<InfoRow
				label={t("host.van.sleeps")}
				value={t("host.van.guests", { count: van.sleeps })}
			/>
			<InfoRow
				label={t("host.van.amenities")}
				value={van.amenities.join(", ")}
			/>
			<InfoRow label={t("host.van.description")} value={van.description} />
		</dl>
	);
}
