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
import { HostBookingCard } from "../components/HostBookingCard";
import { useHostBookings } from "../hooks/useHostBookings";

export default function HostBookingsPage() {
	const { t } = useTranslation();
	const bookingsSearch = useBookingsSearchParams();
	const { bookings, meta, loading, error, refetch } = useHostBookings({
		params: bookingsSearch.queryParams,
	});
	const bookingCount = meta?.total ?? bookings.length;
	const bookingCountLabel = t(
		bookingCount === 1
			? "host.bookings.bookingCountOne"
			: "host.bookings.bookingCountMany",
		{ count: bookingCount },
	);

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	return (
		<>
			<PageHeader
				eyebrow={t("host.bookings.eyebrow")}
				title={t("host.bookings.title")}
				aside={
					<p className="font-medium text-muted-foreground">
						{bookingCountLabel}
					</p>
				}
				className="mb-8"
			/>

			<div className="mb-8 grid gap-5 rounded-xl border border-border bg-card p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] lg:items-end">
				<div className="grid gap-2">
					<p className="font-semibold text-foreground text-sm">
						{t("host.bookings.status")}
					</p>
					<BookingStatusFilter
						selectedStatus={bookingsSearch.statusFilter}
						onSelect={bookingsSearch.handleSelectStatus}
					/>
				</div>

				<BookingsSortControl
					id="host-bookings-sort"
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
						{t("host.bookings.clearControls")}
					</Button>
				</div>
			)}

			{bookings.length > 0 ? (
				<div className="grid gap-5">
					{bookings.map((booking) => (
						<HostBookingCard key={booking.id} booking={booking} />
					))}
				</div>
			) : (
				<EmptyState
					title={t("host.bookings.emptyTitle")}
					message={
						bookingsSearch.hasActiveControls
							? t("host.bookings.emptyFiltered")
							: t("host.bookings.empty")
					}
				/>
			)}

			{meta && (
				<PaginationControls
					ariaLabel={t("host.bookings.paginationAria")}
					page={meta.page}
					totalPages={meta.totalPages}
					total={meta.total}
					totalLabel={t("host.bookings.totalLabel")}
					onPageChange={bookingsSearch.handlePageChange}
				/>
			)}
		</>
	);
}
