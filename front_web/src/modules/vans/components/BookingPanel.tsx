import type { VanDetail } from "@/shared/domain/vans/types";
import { useBookingPanel } from "../hooks/useBookingPanel";
import { BookingCalendar } from "./BookingCalendar";
import { BookingStatus } from "./BookingStatus";
import { BookingSummary } from "./BookingSummary";
import { GuestSelect } from "./GuestSelect";

interface BookingPanelProps {
	van: Pick<VanDetail, "id" | "name" | "price" | "sleeps">;
}

export function BookingPanel({ van }: BookingPanelProps) {
	const bookingPanel = useBookingPanel(van);

	return (
		<section
			aria-labelledby="booking-panel-title"
			className="rounded-xl bg-surface p-5 shadow-sm"
		>
			<div className="mb-5">
				<p className="font-semibold text-clay text-sm uppercase tracking-widest">
					Book this van
				</p>
				<h2
					id="booking-panel-title"
					className="mt-2 font-black text-2xl text-ink"
				>
					Request your trip.
				</h2>
			</div>

			<form className="grid gap-5" onSubmit={bookingPanel.handleSubmit}>
				<BookingCalendar
					dateRange={bookingPanel.dateRange}
					onSelect={bookingPanel.handleDateSelect}
				/>

				<GuestSelect
					guestLimit={van.sleeps}
					guests={bookingPanel.guests}
					onChange={bookingPanel.handleGuestChange}
				/>

				<BookingSummary
					dateRange={bookingPanel.dateRange}
					nights={bookingPanel.nights}
					price={van.price}
					estimatedTotal={bookingPanel.estimatedTotal}
				/>

				<button
					type="submit"
					disabled={!bookingPanel.canSubmit || bookingPanel.loading}
					className="rounded-lg bg-clay px-6 py-3 font-bold text-surface transition-colors hover:bg-clay-dark active:scale-95 disabled:bg-line disabled:text-muted"
				>
					{bookingPanel.submitButtonText}
				</button>

				<BookingStatus
					message={bookingPanel.statusMessage}
					variant={bookingPanel.statusVariant}
				/>
			</form>
		</section>
	);
}
