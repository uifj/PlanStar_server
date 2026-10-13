import { Button } from "@/components/ui/button";
import type { VanDetail } from "@/shared/domain/vans/types";
import { useTranslation } from "@/shared/i18n";
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
	const { t } = useTranslation();

	return (
		<section
			aria-labelledby="booking-panel-title"
			className="rounded-xl bg-card p-5 shadow-sm"
		>
			<div className="mb-5">
				<p className="font-semibold text-primary text-sm uppercase tracking-widest">
					{t("vans.bookThisVan")}
				</p>
				<h2
					id="booking-panel-title"
					className="mt-2 font-black text-2xl text-foreground"
				>
					{t("vans.requestTripTitle")}
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

				<Button
					type="submit"
					disabled={!bookingPanel.canSubmit || bookingPanel.loading}
				>
					{bookingPanel.submitButtonText}
				</Button>

				<BookingStatus
					message={bookingPanel.statusMessage}
					variant={bookingPanel.statusVariant}
				/>
			</form>
		</section>
	);
}
