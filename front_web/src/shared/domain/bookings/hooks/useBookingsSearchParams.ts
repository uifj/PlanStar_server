import { useSearchParams } from "react-router";
import { bookingSortChoices, bookingStatusFilters } from "../queryControls";
import type {
	BookingSortChoice,
	BookingStatus,
	BookingsQueryParams,
} from "../types";

const bookingsPageLimit = 10;
const sortChoiceParams: Record<
	BookingSortChoice,
	Pick<BookingsQueryParams, "sort" | "order">
> = {
	newest: { sort: "createdAt", order: "desc" },
	oldest: { sort: "createdAt", order: "asc" },
	"soonest-trip": { sort: "startDate", order: "asc" },
	"latest-trip": { sort: "startDate", order: "desc" },
	"highest-total": { sort: "totalPrice", order: "desc" },
	"lowest-total": { sort: "totalPrice", order: "asc" },
};

function getValidStatus(status: string | null) {
	return bookingStatusFilters.find((statusFilter) => statusFilter === status);
}

function getValidSortChoice(view: string | null) {
	return (
		bookingSortChoices.find((sortChoice) => sortChoice === view) ?? "newest"
	);
}

function getValidPage(page: string | null) {
	const parsedPage = Number(page);

	return Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
}

function hasValidActiveControls(
	statusFilter: BookingStatus | undefined,
	sortChoice: BookingSortChoice,
	page: number,
) {
	return Boolean(statusFilter) || sortChoice !== "newest" || page > 1;
}

export function useBookingsSearchParams() {
	const [searchParams, setSearchParams] = useSearchParams();
	const statusFilter = getValidStatus(searchParams.get("status"));
	const sortChoice = getValidSortChoice(searchParams.get("view"));
	const page = getValidPage(searchParams.get("page"));
	const { sort, order } = sortChoiceParams[sortChoice];
	const queryParams: BookingsQueryParams = {
		status: statusFilter,
		page,
		limit: bookingsPageLimit,
		sort,
		order,
	};

	function handleSelectStatus(status: BookingStatus) {
		updateSearchParams({ status, page: null });
	}

	function handleClearControls() {
		setSearchParams({});
	}

	function handleSortChoiceChange(sortChoice: BookingSortChoice) {
		updateSearchParams({ view: sortChoice, page: null });
	}

	function handlePageChange(page: number) {
		updateSearchParams({ page: String(page) });
	}

	function updateSearchParams(updates: Record<string, string | null>) {
		const nextParams = new URLSearchParams(searchParams);

		for (const [key, value] of Object.entries(updates)) {
			if (value) {
				nextParams.set(key, value);
			} else {
				nextParams.delete(key);
			}
		}

		setSearchParams(nextParams);
	}

	return {
		statusFilter: statusFilter ?? null,
		sortChoice,
		queryParams,
		hasActiveControls: hasValidActiveControls(statusFilter, sortChoice, page),
		handleSelectStatus,
		handleClearControls,
		handleSortChoiceChange,
		handlePageChange,
	};
}
