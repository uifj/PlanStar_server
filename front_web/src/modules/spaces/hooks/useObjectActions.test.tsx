import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { useObjects } from "@/modules/objects/hooks/useObjects";
import { server } from "@/test/server";
import { useObjectActions } from "./useObjectActions";

function object(
	id: string,
	name: string,
	details: Record<string, unknown> = {},
) {
	return {
		id,
		spaceId: "space-1",
		typeId: "type-van",
		layout: null,
		resolvedLayout: "basic",
		name,
		description: null,
		snippet: null,
		iconEmoji: null,
		details,
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

describe("useObjectActions", () => {
	it("creates an object through the space's object route and refreshes the list", async () => {
		// Arrange
		const stored = [object("o-1", "Sierra Weekender", { price: 89 })];
		let createdBody: unknown = null;

		server.use(
			http.get("/api/spaces/space-1/objects", () =>
				HttpResponse.json({
					data: stored,
					meta: {
						page: 1,
						limit: 50,
						total: stored.length,
						totalPages: 1,
					},
				}),
			),
			http.post("/api/spaces/space-1/objects", async ({ request }) => {
				createdBody = await request.json();
				stored.push(object("o-2", "Alpine Cruiser", { price: 175 }));

				return HttpResponse.json(
					object("o-2", "Alpine Cruiser", { price: 175 }),
					{
						status: 201,
					},
				);
			}),
		);

		const { result } = renderHook(
			() => {
				const list = useObjects({ spaceId: "space-1", query: { limit: 50 } });
				const actions = useObjectActions("space-1");

				return { list, actions };
			},
			{ wrapper },
		);

		await waitFor(() => expect(result.current.list.loading).toBe(false));

		// Act
		await result.current.actions.createObject({
			typeId: "type-van",
			name: "Alpine Cruiser",
			details: { price: 175, type: ["luxury"] },
		});

		// Assert — the POST body is what the kernel's create schema expects
		expect(createdBody).toEqual({
			typeId: "type-van",
			name: "Alpine Cruiser",
			details: { price: 175, type: ["luxury"] },
		});
		await waitFor(() =>
			expect(result.current.list.objects.map((o) => o.name)).toEqual([
				"Sierra Weekender",
				"Alpine Cruiser",
			]),
		);
	});

	it("edits a value without resending the whole document", async () => {
		// Arrange
		const patchBodies: unknown[] = [];

		server.use(
			http.patch("/api/objects/o-1", async ({ request }) => {
				patchBodies.push(await request.json());

				return HttpResponse.json(
					object("o-1", "Sierra Weekender", { price: 99 }),
				);
			}),
		);

		const { result } = renderHook(() => useObjectActions("space-1"), {
			wrapper,
		});

		// Act
		await result.current.setDetail("o-1", "price", 99);

		// Assert — details merge on the server, so only the changed key travels
		expect(patchBodies[0]).toEqual({ details: { price: 99 } });
	});

	it("retires an object through the archive route", async () => {
		// Arrange
		let deleted = "";

		server.use(
			http.delete("/api/objects/:objectId", ({ params }) => {
				deleted = params.objectId as string;

				return new HttpResponse(null, { status: 204 });
			}),
		);

		const { result } = renderHook(() => useObjectActions("space-1"), {
			wrapper,
		});

		// Act
		await result.current.archiveObject("o-1");

		// Assert
		expect(deleted).toBe("o-1");
	});
});
