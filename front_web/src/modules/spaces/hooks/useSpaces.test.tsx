import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "@/test/server";
import { useSpaces } from "./useSpaces";

function space(id: string, name: string) {
	return {
		id,
		name,
		status: "active",
		permission: "writer",
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-02T00:00:00.000Z",
	};
}

function wrapper() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	function Provider({ children }: { children: ReactNode }) {
		return (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
	}

	return { Provider };
}

describe("useSpaces", () => {
	it("lists the spaces the caller belongs to", async () => {
		// Arrange
		server.use(
			http.get("/api/spaces", () =>
				HttpResponse.json({
					data: [
						space("vanlife-space", "VanLife"),
						space("s-2", "Field notes"),
					],
					meta: { page: 1, limit: 10, total: 2, totalPages: 1 },
				}),
			),
		);

		// Act
		const { result } = renderHook(() => useSpaces(), {
			wrapper: wrapper().Provider,
		});

		// Assert
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(result.current.spaces.map((s) => s.name)).toEqual([
			"VanLife",
			"Field notes",
		]);
		expect(result.current.error).toBeNull();
	});

	it("refuses to read the rail without a session", async () => {
		// Arrange
		server.use(
			http.get("/api/spaces", () =>
				HttpResponse.json(
					{ message: "Please sign in to continue." },
					{ status: 401 },
				),
			),
		);

		// Act
		const { result } = renderHook(() => useSpaces(), {
			wrapper: wrapper().Provider,
		});

		// Assert
		await waitFor(() => expect(result.current.error).not.toBeNull());
		expect(result.current.spaces).toEqual([]);
	});

	it("adds a created space to the rail", async () => {
		// Arrange
		const created = space("s-3", "Roadbook");
		let listed = [space("vanlife-space", "VanLife")];

		server.use(
			http.get("/api/spaces", () =>
				HttpResponse.json({
					data: listed,
					meta: { page: 1, limit: 10, total: listed.length, totalPages: 1 },
				}),
			),
			http.post("/api/spaces", async ({ request }) => {
				const body = (await request.json()) as { name: string };

				created.name = body.name;
				listed = [...listed, created];

				return HttpResponse.json(created, { status: 201 });
			}),
		);

		const { result } = renderHook(() => useSpaces(), {
			wrapper: wrapper().Provider,
		});

		await waitFor(() => expect(result.current.loading).toBe(false));

		// Act
		await result.current.createSpace("Roadbook");

		// Assert — the rail shows it without a manual refresh
		await waitFor(() =>
			expect(result.current.spaces.map((s) => s.name)).toContain("Roadbook"),
		);
	});
});
