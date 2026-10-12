interface InfoRowProps {
	label: string;
	value: string;
}

export default function InfoRow({ label, value }: InfoRowProps) {
	return (
		<div className="flex flex-col gap-1 text-sm sm:flex-row sm:gap-3">
			<dt className="w-24 shrink-0 font-bold text-ink">{label}</dt>
			<dd className="font-medium text-muted">{value}</dd>
		</div>
	);
}
