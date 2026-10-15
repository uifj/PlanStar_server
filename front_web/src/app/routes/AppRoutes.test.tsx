import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/modules/auth/context/AuthProvider";
import { LangProvider } from "@/shared/i18n";
import { ThemeProvider } from "@/shared/theme";
import { server } from "@/test/server";
import { AppRoutes } from "./AppRoutes";

const meta = { page: 1, limit: 100, total: 0, totalPages: 1 };

function serveSpace() {
	server.use(
		http.get("/api/me", () =>
			HttpResponse.json({
				id: "user-1",
				name: "Ada",
				email: "ada@example.com",
				role: "user",
			}),
		),
		http.get("/api/spaces", () =>
			HttpResponse.json({
				data: [
					{
						id: "space-1",
						name: "VanLife Trips",
						status: "active",
						permission: "writer",
						createdAt: "2026-10-01T00:00:00.000Z",
						updatedAt: "2026-10-02T00:00:00.000Z",
					},
				],
				meta,
			}),
		),
		http.get("/api/spaces/space-1/object-types", () =>
			HttpResponse.json({ data: [], meta }),
		),
		http.get("/api/spaces/space-1/relations", () =>
			HttpResponse.json({ data: [], meta }),
		),
		http.get("/api/spaces/space-1/objects", () =>
			HttpResponse.json({ data: [], meta }),
		),
	);
}

function renderApp() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={["/space?spaceId=space-1"]}>
				<ThemeProvider>
					<LangProvider>
						<AuthProvider>
							<AppRoutes />
						</AuthProvider>
					</LangProvider>
				</ThemeProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("AppRoutes", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("serves the space browser when the dev flag is off", async () => {
		// Arrange — the object workspace is a production page, not a dev-only one
		vi.stubEnv("DEV", false);
		serveSpace();

		// Act
		renderApp();

		// Assert
		expect(await screen.findByText("Every type")).toBeInTheDocument();
	});
});
