import { BookingStatusBadge } from "@/shared/domain/bookings/components/BookingStatusBadge";
import {
	getBookingDateRange,
	getGuestLabel,
} from "@/shared/domain/bookings/utils/bookingFormat";
import VanTypeBadge from "@/shared/domain/vans/components/VanTypeBadge";
import { LANGUAGE_LOCALES, useTranslation } from "@/shared/i18n";
import type { HostBooking } from "../types";
import { HostBookingActions } from "./HostBookingActions";

interface HostBookingCardProps {
	booking: HostBooking;
}

export function HostBookingCard({ booking }: HostBookingCardProps) {
	const { t, language } = useTranslation();
	const dateRange = getBookingDateRange(
		booking.startDate,
		booking.endDate,
		LANGUAGE_LOCALES[language],
	);
	const guestLabel = getGuestLabel(booking.guests, t);
	const totalPrice = booking.totalPrice.toLocaleString();

	return (
		<article className="grid gap-4 rounded-xl bg-card p-4 shadow-sm sm:grid-cols-[9rem_1fr] sm:p-5">
			<img
				src={booking.van.imageUrl}
				alt={booking.van.name}
				className="aspect-video w-full rounded-lg bg-secondary object-cover sm:aspect-square"
			/>

			<div className="min-w-0">
				<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
					<div className="min-w-0">
						<h2 className="font-black text-2xl text-foreground leading-tight">
							{booking.van.name}
						</h2>
						<p className="mt-1 font-medium text-muted-foreground text-sm">
							{t("host.booking.requestedBy", { name: booking.renter.name })}
						</p>
					</div>
					<BookingStatusBadge status={booking.status} />
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<VanTypeBadge
						type={booking.van.type}
						className="px-2 py-0.5 text-xs"
					/>
					<span className="font-semibold text-muted-foreground text-sm">
						{guestLabel}
					</span>
				</div>

				<div className="mt-5 grid gap-3 border-border border-t pt-4 sm:grid-cols-3">
					<div className="sm:col-span-2">
						<p className="font-semibold text-muted-foreground text-sm">
							{t("host.booking.tripDates")}
						</p>
						<p className="mt-1 font-bold text-foreground">{dateRange}</p>
					</div>
					<div className="sm:text-right">
						<p className="font-semibold text-muted-foreground text-sm">
							{t("host.booking.total")}
						</p>
						<p className="mt-1 font-black text-foreground text-xl">
							${totalPrice}
						</p>
					</div>
				</div>

				<HostBookingActions
					bookingId={booking.id}
					status={booking.status}
					endDate={booking.endDate}
				/>
			</div>
		</article>
	);
}
