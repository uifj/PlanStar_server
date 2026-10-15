import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { useDataviews } from "./useDataviews";

function view(
	id: string,
	name: string,
	extraDetails: Record<string, unknown> = {},
) {
	return {
		id,
		spaceId: "space-1",
		typeId: null,
		layout: "dataview",
		resolvedLayout: "dataview",
		name,
		description: null,
		snippet: null,
		iconEmoji: null,
		details: {
			viewType: "grid",
			dataviewFilters: [{ key: "budget", operator: "greater", value: 100 }],
			dataviewSorts: [{ key: "budget", order: "desc" }],
			...extraDetails,
		},
		isArchived: false,
		isDeleted: false,
		isHidden: false,
		isFavorite: false,
		done: null,
		creatorId: "user-1",
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-01T00:00:00.000Z",
	};
}

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useDataviews", () => {
	it("asks the kernel for the dataview layout only", async () => {
		// Arrange
		let requestedLayout: string | null = null;

		server.use(
			http.get("/api/spaces/space-1/objects", ({ request }) => {
				requestedLayout = new URL(request.url).searchParams.get("layout");

				return HttpResponse.json({
					data: [view("view-1", "Expensive trips")],
					meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
				});
			}),
		);

		// Act
		const { result } = renderHook(() => useDataviews("space-1"), { wrapper });

		// Assert
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(requestedLayout).toBe("dataview");
		expect(result.current.views.map((v) => v.name)).toEqual([
			"Expensive trips",
		]);
		expect(result.current.views[0]?.details.dataviewFilters).toHaveLength(1);
	});

	it("saves the current query as a view and lists it afterwards", async () => {
		// Arrange
		const stored = [view("view-1", "Expensive trips")];
		const savedBodies: unknown[] = [];

		server.use(
			http.get("/api/spaces/space-1/objects", () =>
				HttpResponse.json({
					data: stored,
					meta: {
						page: 1,
						limit: 100,
						total: stored.length,
						totalPages: 1,
					},
				}),
			),
			http.post("/api/spaces/space-1/dataviews", async ({ request }) => {
				const body = (await request.json()) as Record<string, unknown>;

				savedBodies.push(body);
				stored.push(view("view-2", body.name as string));

				return HttpResponse.json(view("view-2", body.name as string), {
					status: 201,
				});
			}),
		);

		const { result } = renderHook(() => useDataviews("space-1"), { wrapper });

		await waitFor(() => expect(result.current.loading).toBe(false));

		// Act
		await result.current.saveView({
			name: "Cheap first",
			sourceTypeId: "type-1",
			filters: [{ key: "budget", operator: "less", value: 120 }],
			sorts: [{ key: "budget", order: "asc" }],
		});

		// Assert — the view reached the server as a stored query, not a screenshot
		expect(savedBodies[0]).toEqual({
			name: "Cheap first",
			sourceTypeId: "type-1",
			filters: [{ key: "budget", operator: "less", value: 120 }],
			sorts: [{ key: "budget", order: "asc" }],
		});
		await waitFor(() =>
			expect(result.current.views.map((v) => v.name)).toContain("Cheap first"),
		);
	});

	it("hides a view that has been archived", async () => {
		// Arrange — the kernel lists archived objects; a rail of dead views is not useful
		const archived = { ...view("view-9", "Old run"), isArchived: true };

		server.use(
			http.get("/api/spaces/space-1/objects", () =>
				HttpResponse.json({
					data: [view("view-1", "Expensive trips"), archived],
					meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
				}),
			),
		);

		// Act
		const { result } = renderHook(() => useDataviews("space-1"), { wrapper });

		// Assert
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.views.map((v) => v.name)).toEqual([
			"Expensive trips",
		]);
	});

	it("renames a view through the generic object route", async () => {
		// Arrange
		const stored = [view("view-1", "Expensive trips")];
		let patchedBody: unknown = null;

		server.use(
			http.get("/api/spaces/space-1/objects", () =>
				HttpResponse.json({
					data: stored,
					meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
				}),
			),
			http.patch("/api/objects/view-1", async ({ request }) => {
				patchedBody = await request.json();
				stored[0] = view("view-1", "Trips over $100");

				return HttpResponse.json(stored[0]);
			}),
		);

		const { result } = renderHook(() => useDataviews("space-1"), { wrapper });

		await waitFor(() => expect(result.current.loading).toBe(false));

		// Act
		await result.current.renameView("view-1", "Trips over $100");

		// Assert — a view is an object, so renaming it is a name patch
		expect(patchedBody).toEqual({ name: "Trips over $100" });
		await waitFor(() =>
			expect(result.current.views.map((v) => v.name)).toEqual([
				"Trips over $100",
			]),
		);
	});

	it("saves the layout onto the view itself", async () => {
		// Arrange
		const stored = [view("view-1", "Expensive trips")];
		let patchedBody: unknown = null;

		server.use(
			http.get("/api/spaces/space-1/objects", () =>
				HttpResponse.json({
					data: stored,
					meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
				}),
			),
			http.patch(
				"/api/spaces/space-1/dataviews/view-1",
				async ({ request }) => {
					patchedBody = await request.json();
					stored[0] = view("view-1", "Expensive trips", {
						viewType: "board",
						groupRelationKey: "type",
					});

					return HttpResponse.json(stored[0]);
				},
			),
		);

		const { result } = renderHook(() => useDataviews("space-1"), { wrapper });

		await waitFor(() => expect(result.current.loading).toBe(false));

		// Act
		await result.current.setLayout("view-1", {
			viewType: "board",
			groupRelationKey: "type",
		});

		// Assert — the layout travels with the view, not with the caller's URL
		expect(patchedBody).toEqual({
			viewType: "board",
			groupRelationKey: "type",
		});
		await waitFor(() =>
			expect(result.current.views[0]?.details.viewType).toBe("board"),
		);
	});
});
