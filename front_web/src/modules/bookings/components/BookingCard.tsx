import { BookingStatusBadge } from "@/shared/domain/bookings/components/BookingStatusBadge";
import {
	getBookingDateRange,
	getGuestLabel,
} from "@/shared/domain/bookings/utils/bookingFormat";
import VanTypeBadge from "@/shared/domain/vans/components/VanTypeBadge";
import { LANGUAGE_LOCALES, useTranslation } from "@/shared/i18n";
import type { RenterBooking } from "../types";
import { CancelBookingButton } from "./CancelBookingButton";
import { ReviewBookingForm } from "./ReviewBookingForm";
import { SubmittedReview } from "./SubmittedReview";

interface BookingCardProps {
	booking: RenterBooking;
}

export function BookingCard({ booking }: BookingCardProps) {
	const { t, language } = useTranslation();
	const dateRange = getBookingDateRange(
		booking.startDate,
		booking.endDate,
		LANGUAGE_LOCALES[language],
	);
	const guestLabel = getGuestLabel(booking.guests, t);
	const totalPrice = booking.totalPrice.toLocaleString();
	const canCancel =
		booking.status === "pending" || booking.status === "confirmed";
	const canReview = booking.status === "completed" && !booking.review;

	return (
		<article className="grid gap-4 rounded-xl bg-card p-4 shadow-sm sm:grid-cols-[10rem_1fr] sm:p-5">
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
							{booking.van.location}
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

				<div className="mt-5 grid gap-3 border-border border-t pt-4 sm:grid-cols-2">
					<div>
						<p className="font-semibold text-muted-foreground text-sm">
							{t("bookings.tripDates")}
						</p>
						<p className="mt-1 font-bold text-foreground">{dateRange}</p>
					</div>
					<div className="sm:text-right">
						<p className="font-semibold text-muted-foreground text-sm">
							{t("bookings.total")}
						</p>
						<p className="mt-1 font-black text-foreground text-xl">
							${totalPrice}
						</p>
					</div>
				</div>

				{canCancel ? (
					<div className="mt-5 border-border border-t pt-4">
						<CancelBookingButton bookingId={booking.id} />
					</div>
				) : null}

				{canReview ? (
					<div className="mt-5 border-border border-t pt-4">
						<h3 className="mb-3 font-black text-foreground text-lg">
							{t("bookings.reviewYourTrip")}
						</h3>
						<ReviewBookingForm bookingId={booking.id} />
					</div>
				) : null}

				{booking.review ? <SubmittedReview review={booking.review} /> : null}
			</div>
		</article>
	);
}
