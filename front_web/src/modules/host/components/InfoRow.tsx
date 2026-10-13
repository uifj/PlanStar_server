interface InfoRowProps {
	label: string;
	value: string;
}

export default function InfoRow({ label, value }: InfoRowProps) {
	return (
		<div className="flex flex-col gap-1 text-sm sm:flex-row sm:gap-3">
			<dt className="w-24 shrink-0 font-bold text-foreground">{label}</dt>
			<dd className="font-medium text-muted-foreground">{value}</dd>
		</div>
	);
}
