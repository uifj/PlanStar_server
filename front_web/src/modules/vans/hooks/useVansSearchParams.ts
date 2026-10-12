import { useSearchParams } from "react-router";
import {
	type VansQueryParams,
	type VanType,
	vanTypes,
} from "@/shared/domain/vans/types";
import { type VansSortChoice, vansSortChoices } from "../queryControls";

const vansPageLimit = 6;
const sortChoiceParams: Record<
	VansSortChoice,
	Pick<VansQueryParams, "sort" | "order">
> = {
	newest: { sort: "createdAt", order: "desc" },
	oldest: { sort: "createdAt", order: "asc" },
	"highest-price": { sort: "price", order: "desc" },
	"lowest-price": { sort: "price", order: "asc" },
	"highest-rating": { sort: "rating", order: "desc" },
	"lowest-rating": { sort: "rating", order: "asc" },
	"name-a-z": { sort: "name", order: "asc" },
	"name-z-a": { sort: "name", order: "desc" },
};

function getValidType(type: string | null) {
	return vanTypes.find((vanType) => vanType === type) ?? null;
}

function getValidSortChoice(view: string | null) {
	return vansSortChoices.find((sortChoice) => sortChoice === view) ?? "newest";
}

function getValidPage(page: string | null) {
	const parsedPage = Number(page);

	return Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
}

export function useVansSearchParams() {
	const [searchParams, setSearchParams] = useSearchParams();
	const typeFilter = getValidType(searchParams.get("type"));
	const searchFilter = searchParams.get("search")?.trim() ?? "";
	const page = getValidPage(searchParams.get("page"));
	const sortChoice = getValidSortChoice(searchParams.get("view"));
	const { sort, order } = sortChoiceParams[sortChoice];
	const queryParams: VansQueryParams = {
		type: typeFilter ?? undefined,
		search: searchFilter || undefined,
		page,
		limit: vansPageLimit,
		sort,
		order,
	};
	const search = searchParams.toString();

	function handleSelectFilter(type: VanType) {
		updateSearchParams({ type, page: null });
	}

	function handleClearFilter() {
		setSearchParams({});
	}

	function handleSearchChange(search: string) {
		updateSearchParams({ search, page: null });
	}

	function handleSortChoiceChange(sortChoice: VansSortChoice) {
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
		typeFilter,
		searchFilter,
		sortChoice,
		queryParams,
		search,
		hasActiveControls: searchParams.size > 0,
		handleSelectFilter,
		handleClearFilter,
		handleSearchChange,
		handleSortChoiceChange,
		handlePageChange,
	};
}
