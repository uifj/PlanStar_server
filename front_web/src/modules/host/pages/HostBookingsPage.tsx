import { EmptyState } from "@/shared/components/EmptyState";
import ErrorMessage from "@/shared/components/ErrorMessage";
import LoadingSpinner from "@/shared/components/LoadingSpinner";
import { PageHeader } from "@/shared/components/PageHeader";
import { PaginationControls } from "@/shared/components/PaginationControls";
import { BookingStatusFilter } from "@/shared/domain/bookings/components/BookingStatusFilter";
import { BookingsSortControl } from "@/shared/domain/bookings/components/BookingsSortControl";
import { useBookingsSearchParams } from "@/shared/domain/bookings/hooks/useBookingsSearchParams";
import { HostBookingCard } from "../components/HostBookingCard";
import { useHostBookings } from "../hooks/useHostBookings";

export default function HostBookingsPage() {
	const bookingsSearch = useBookingsSearchParams();
	const { bookings, meta, loading, error, refetch } = useHostBookings({
		params: bookingsSearch.queryParams,
	});
	const bookingCountLabel =
		meta?.total === 1
			? "1 booking"
			: `${meta?.total ?? bookings.length} bookings`;

	if (loading) {
		return <LoadingSpinner />;
	}

	if (error) {
		return <ErrorMessage onRetry={refetch} />;
	}

	return (
		<>
			<PageHeader
				eyebrow="Booking requests"
				title="Manage trips for your vans."
				aside={<p className="font-medium text-muted">{bookingCountLabel}</p>}
				className="mb-8"
			/>

			<div className="mb-8 grid gap-5 rounded-xl border border-line bg-surface p-4 shadow-sm lg:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)] lg:items-end">
				<div className="grid gap-2">
					<p className="font-semibold text-ink text-sm">Status</p>
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
					<button
						type="button"
						onClick={bookingsSearch.handleClearControls}
						className="font-semibold text-muted transition-colors hover:text-clay"
					>
						Clear controls
					</button>
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
					title="No booking requests"
					message={
						bookingsSearch.hasActiveControls
							? "There are no host bookings matching these controls. Clear the controls to see every request."
							: "Requests for your vans will show up here when renters book a trip."
					}
				/>
			)}

			{meta && (
				<PaginationControls
					ariaLabel="Host booking pages"
					page={meta.page}
					totalPages={meta.totalPages}
					total={meta.total}
					totalLabel="bookings"
					onPageChange={bookingsSearch.handlePageChange}
				/>
			)}
		</>
	);
}
