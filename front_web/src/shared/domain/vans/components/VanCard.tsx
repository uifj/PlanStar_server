import { FaStar } from "react-icons/fa6";
import { Link, type To } from "react-router";
import type { Van } from "../types";
import VanTypeBadge from "./VanTypeBadge";

interface VanCardProps {
	van: Van;
	to: To;
	state?: unknown;
}

export default function VanCard({ van, to, state }: VanCardProps) {
	return (
		<Link
			to={to}
			state={state}
			aria-label={`View details for ${van.name}, priced at $${van.price} per day`}
			className="group block h-full"
		>
			<div className="overflow-hidden rounded-xl bg-panel">
				<img
					src={van.imageUrl}
					alt={van.name}
					decoding="async"
					className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-105"
				/>
			</div>

			<div className="mt-4 flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h2 className="font-bold text-2xl text-ink leading-tight">
						{van.name}
					</h2>
					<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-medium text-muted text-sm">
						<span>{van.location}</span>
						<span className="inline-flex items-center gap-1 text-ink">
							<FaStar className="text-clay" aria-hidden="true" />
							{van.rating.toFixed(1)}
						</span>
					</div>
					<p className="mt-2 text-muted">
						<span className="font-bold text-ink text-xl">${van.price}</span>
						<span className="font-medium text-sm"> / day</span>
					</p>
				</div>

				<VanTypeBadge type={van.type} />
			</div>
		</Link>
	);
}
