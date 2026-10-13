import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import type { ObjectDetail, ObjectsResponse } from "../types";
import { useObjects } from "./useObjects";

const object: ObjectDetail = {
	id: "obj-1",
	spaceId: "space-1",
	typeId: "type-1",
	layout: null,
	resolvedLayout: "basic",
	name: "Iceland",
	description: null,
	snippet: null,
	iconEmoji: null,
	details: { budget: 150 },
	isArchived: false,
	isDeleted: false,
	isHidden: false,
	isFavorite: false,
	done: null,
	creatorId: "user-1",
	createdAt: "2026-10-13T00:00:00.000Z",
	updatedAt: "2026-10-13T00:00:00.000Z",
};

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useObjects", () => {
	it("sends the filter as JSON and keeps the rows", async () => {
		// Arrange
		let requestedFilters: string | null = null;
		const body: ObjectsResponse = {
			data: [object],
			meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
		};

		server.use(
			http.get("/api/spaces/space-1/objects", ({ request }) => {
				requestedFilters = new URL(request.url).searchParams.get("filters");

				return HttpResponse.json(body);
			}),
		);

		// Act
		const { result } = renderHook(
			() =>
				useObjects({
					spaceId: "space-1",
					query: {
						filters: [{ key: "budget", operator: "greater", value: 100 }],
					},
				}),
			{ wrapper },
		);

		// Assert
		await waitFor(() => expect(result.current.loading).toBe(false));

		expect(requestedFilters).toBe(
			JSON.stringify([{ key: "budget", operator: "greater", value: 100 }]),
		);
		expect(result.current.objects).toEqual([object]);
		expect(result.current.meta?.total).toBe(1);
	});

	it("does not request objects without a space", async () => {
		// Act
		const { result } = renderHook(() => useObjects({ spaceId: undefined }), {
			wrapper,
		});

		// Assert
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.objects).toEqual([]);
	});
});
