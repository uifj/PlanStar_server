export type SortOrder = "asc" | "desc";

export type SortingOptions<TSortField extends string> = {
	defaultField: TSortField;
	defaultOrder?: SortOrder;
};

export function getSorting<TSortField extends string>(
	sortField: TSortField | undefined,
	sortOrder: SortOrder,
	options: SortingOptions<TSortField>,
): {
	orderBy: Record<TSortField, SortOrder>;
} {
	const field = sortField ?? options.defaultField;
	const order = sortOrder ?? options.defaultOrder ?? "asc";

	return {
		orderBy: {
			[field]: order,
		} as Record<TSortField, SortOrder>,
	};
}
