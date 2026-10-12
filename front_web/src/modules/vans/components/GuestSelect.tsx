import { FaChevronDown } from "react-icons/fa6";

interface GuestSelectProps {
	guestLimit: number;
	guests: number;
	onChange: (guests: number) => void;
}

export function GuestSelect({
	guestLimit,
	guests,
	onChange,
}: GuestSelectProps) {
	const guestOptions = Array.from(
		{ length: guestLimit },
		(_, index) => index + 1,
	);

	function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
		onChange(Number(event.target.value));
	}

	return (
		<div className="grid gap-2">
			<label
				htmlFor="booking-guests"
				className="font-semibold text-ink text-sm"
			>
				Guests
			</label>
			<div className="relative">
				<select
					id="booking-guests"
					value={guests}
					onChange={handleChange}
					className="w-full appearance-none rounded-lg border border-line bg-surface py-3 pr-12 pl-4 font-medium text-ink outline-none ring-clay transition focus:ring-2"
				>
					{guestOptions.map((guestCount) => (
						<option key={guestCount} value={guestCount}>
							{guestCount} {guestCount === 1 ? "guest" : "guests"}
						</option>
					))}
				</select>
				<FaChevronDown className="pointer-events-none absolute top-1/2 right-4 size-3 -translate-y-1/2 text-muted" />
			</div>
		</div>
	);
}
