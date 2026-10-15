import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/modules/auth/context/AuthProvider";
import { LangProvider } from "@/shared/i18n";
import { ThemeProvider } from "@/shared/theme";
import { server } from "@/test/server";
import RootLayout from "./RootLayout";

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

// The shell reads the session for its navigation and the space list for its rail,
// so both are served the way the API serves them.
function serveShellData() {
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
					space("space-1", "VanLife Trips"),
					space("space-2", "Field Notes"),
				],
				meta: { page: 1, limit: 100, total: 2, totalPages: 1 },
			}),
		),
	);
}

function serveRegistry() {
	server.use(
		http.get("/api/spaces/space-1/object-types", () =>
			HttpResponse.json({
				data: [
					{
						id: "type-van",
						spaceId: "space-1",
						uniqueKey: "van",
						name: "Campervan",
						description: null,
						iconEmoji: null,
						layout: "basic",
						relationKeys: [],
					},
				],
				meta: { page: 1, limit: 100, total: 1, totalPages: 1 },
			}),
		),
		http.get("/api/spaces/space-1/relations", () =>
			HttpResponse.json({
				data: [],
				meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
			}),
		),
	);
}

function object(id: string, name: string, details: Record<string, unknown>) {
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
		createdAt: "2026-10-13T00:00:00.000Z",
		updatedAt: "2026-10-13T00:00:00.000Z",
	};
}

// The context column reads the focused object and whatever links to it.
function serveFocusObject() {
	server.use(
		http.get("/api/objects/obj-9", () =>
			HttpResponse.json(object("obj-9", "Sierra Weekender", { price: 89 })),
		),
		http.get("/api/objects/obj-9/backlinks", () =>
			HttpResponse.json({
				data: [object("obj-1", "Trip notes", {})],
				meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
			}),
		),
	);
}

function renderShell(entry = "/") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});

	render(
		<QueryClientProvider client={client}>
			<MemoryRouter initialEntries={[entry]}>
				<ThemeProvider>
					<LangProvider>
						<AuthProvider>
							<Routes>
								<Route path="/" element={<RootLayout />}>
									<Route index element={<div>page body</div>} />
									<Route path="/space" element={<div>space browser</div>} />
									<Route
										path="/object/:objectId"
										element={<div>object page</div>}
									/>
								</Route>
							</Routes>
						</AuthProvider>
					</LangProvider>
				</ThemeProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("RootLayout", () => {
	it("puts the navigation and the caller's spaces in the left rail", async () => {
		// Arrange
		serveShellData();

		// Act
		renderShell();

		// Assert — the rail is the navigation landmark, and it carries the spaces
		const rail = await screen.findByRole("navigation", {
			name: "Primary navigation",
		});

		await within(rail).findByText("Bookings");
		await within(rail).findByText("Field Notes");
	});

	it("links the workspace from the rail even with no spaces", async () => {
		// Arrange — a member of nothing yet, which is every fresh account
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
					data: [],
					meta: { page: 1, limit: 100, total: 0, totalPages: 1 },
				}),
			),
		);

		// Act
		renderShell();

		// Assert — the object workspace is reachable by click, not only by URL
		const rail = await screen.findByRole("navigation", {
			name: "Primary navigation",
		});

		expect(
			await within(rail).findByRole("link", { name: "Space browser" }),
		).toHaveAttribute("href", "/space");
	});

	it("keeps the page in the middle column", async () => {
		// Arrange
		serveShellData();

		// Act
		renderShell();

		// Assert
		expect(await screen.findByText("page body")).toBeInTheDocument();
	});

	it("shows no context column while nothing is focused", async () => {
		// Arrange
		serveShellData();

		// Act
		renderShell();

		// Assert — the rail has loaded, so the absence is the shell's choice
		await screen.findByRole("navigation", { name: "Primary navigation" });

		expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
	});

	it("opens the focused object as a page", async () => {
		// Arrange
		serveShellData();
		serveRegistry();
		serveFocusObject();
		renderShell("/space?spaceId=space-1&focus=obj-9");

		const panel = await screen.findByRole("complementary");

		// Act
		fireEvent.click(await within(panel).findByRole("link", { name: "Open" }));

		// Assert — the peek hands over to the full page
		expect(await screen.findByText("object page")).toBeInTheDocument();
		expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
	});

	it("marks the open space and offers its types under it", async () => {
		// Arrange
		serveShellData();
		serveRegistry();

		// Act
		renderShell("/space?spaceId=space-1");

		// Assert — the rail knows which space the page is showing
		const rail = await screen.findByRole("navigation", {
			name: "Primary navigation",
		});
		const openSpace = await within(rail).findByRole("link", {
			name: "VanLife Trips",
		});

		expect(openSpace).toHaveAttribute("aria-current", "page");

		// …and a type is one click, not a dropdown inside the page
		const typeLink = await within(rail).findByRole("link", {
			name: "Campervan",
		});

		expect(typeLink).toHaveAttribute(
			"href",
			"/space?spaceId=space-1&typeId=type-van",
		);
	});

	it("opens a context column for the focused object", async () => {
		// Arrange
		serveShellData();
		serveRegistry();
		serveFocusObject();

		// Act
		renderShell("/space?spaceId=space-1&focus=obj-9");

		// Assert
		const panel = await screen.findByRole("complementary");

		await within(panel).findByText("Sierra Weekender");
		await within(panel).findByText("price");
		await within(panel).findByText("Trip notes");
	});

	it("closes the context column by dropping the focus", async () => {
		// Arrange
		serveShellData();
		serveRegistry();
		serveFocusObject();
		renderShell("/space?spaceId=space-1&focus=obj-9");

		const panel = await screen.findByRole("complementary");

		// Act
		fireEvent.click(within(panel).getByRole("button", { name: "Close panel" }));

		// Assert
		await waitFor(() =>
			expect(screen.queryByRole("complementary")).not.toBeInTheDocument(),
		);
	});
});
