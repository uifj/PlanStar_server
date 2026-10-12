import type { VanDetail } from "@/shared/domain/vans/types";
import InfoRow from "./InfoRow";

interface VanInfoProps {
	van: VanDetail;
}

export default function VanInfo({ van }: VanInfoProps) {
	return (
		<dl className="flex flex-col gap-5">
			<InfoRow label="Name" value={van.name} />
			<InfoRow label="Location" value={van.location} />
			<InfoRow label="Rating" value={van.rating.toFixed(1)} />
			<InfoRow label="Sleeps" value={`${van.sleeps} guests`} />
			<InfoRow label="Amenities" value={van.amenities.join(", ")} />
			<InfoRow label="Description" value={van.description} />
		</dl>
	);
}
