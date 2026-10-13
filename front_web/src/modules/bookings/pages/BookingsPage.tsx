import { Button } from "@/components/ui/button";
import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { PaginationControls } from "@/shared/components/PaginationControls";
import { BookingStatusFilter } from "@/shared/domain/bookings/components/BookingStatusFilter";
import { BookingsSortControl } from "@/shared/domain/bookings/components/BookingsSortControl";
import { useBookingsSearchParams } from "@/shared/domain/bookings/hooks/useBookingsSearchParams";
import { useTranslation } from "@/shared/i18n";
import { BookingCard } from "../components/BookingCard";
import { useBookings } from "../hooks/useBookings";

export default function BookingsPage() {
	const bookingsSearch = useBookingsSearchParams();
	const { bookings, meta, loading, error, refetch } = useBookings({
		params: bookingsSearch.queryParams,
	});
	const { t } = useTranslation();
	const bookingCountLabel =
		meta?.total === 1
			? t("bookings.countSingular")
			: t("bookings.countPlural", { count: meta?.total ?? bookings.length });

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	return (
		<section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
			<PageHeader
				eyebrow={t("bookings.eyebrow")}
				title={t("bookings.title")}
				aside={
					<p className="font-medium text-muted-foreground">
						{bookingCountLabel}
					</p>
				}
			/>

			<div className="mb-8 grid gap-5 rounded-xl border border-border bg-card p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] lg:items-end">
				<div className="grid gap-2">
					<p className="font-semibold text-foreground text-sm">
						{t("bookings.statusLabel")}
					</p>
					<BookingStatusFilter
						selectedStatus={bookingsSearch.statusFilter}
						onSelect={bookingsSearch.handleSelectStatus}
					/>
				</div>

				<BookingsSortControl
					id="bookings-sort"
					sortChoice={bookingsSearch.sortChoice}
					onSortChoiceChange={bookingsSearch.handleSortChoiceChange}
				/>
			</div>

			{bookingsSearch.hasActiveControls && (
				<div className="mb-8 flex justify-end">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={bookingsSearch.handleClearControls}
						className="font-semibold text-muted-foreground hover:bg-transparent hover:text-primary"
					>
						{t("bookings.clearControls")}
					</Button>
				</div>
			)}

			{bookings.length > 0 ? (
				<div className="grid gap-5">
					{bookings.map((booking) => (
						<BookingCard key={booking.id} booking={booking} />
					))}
				</div>
			) : (
				<EmptyState
					title={t("bookings.emptyTitle")}
					message={
						bookingsSearch.hasActiveControls
							? t("bookings.emptyWithControls")
							: t("bookings.emptyDefault")
					}
				/>
			)}

			{meta && (
				<PaginationControls
					ariaLabel={t("bookings.paginationAriaLabel")}
					page={meta.page}
					totalPages={meta.totalPages}
					total={meta.total}
					totalLabel={t("bookings.totalLabel")}
					onPageChange={bookingsSearch.handlePageChange}
				/>
			)}
		</section>
	);
}
