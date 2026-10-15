import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/modules/auth/context/AuthProvider";
import { LangProvider } from "@/shared/i18n";
import { ThemeProvider } from "@/shared/theme";
import { server } from "@/test/server";
import ObjectPage from "./ObjectPage";

const meta = { page: 1, limit: 100, total: 1, totalPages: 1 };

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
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-02T00:00:00.000Z",
	};
}

const sierra = () =>
	object("van-1", "Sierra Weekender", {
		price: 89,
		imageUrl: "https://images.example.com/a.jpg",
	});

// The page reads the object, what links to it, and the space's registry for the
// labels and the cover, so all four are served as the API serves them.
function serveObject() {
	server.use(
		http.get("/api/me", () =>
			HttpResponse.json({
				id: "user-1",
				name: "Ada",
				email: "ada@example.com",
				role: "user",
			}),
		),
		http.get("/api/objects/van-1", () => HttpResponse.json(sierra())),
		http.get("/api/objects/van-1/backlinks", () =>
			HttpResponse.json({
				data: [object("booking-1", "Trip notes", {})],
				meta,
			}),
		),
		http.get("/api/spaces/space-1/object-types", () =>
			HttpResponse.json({
				data: [
					{
						id: "type-van",
						spaceId: "space-1",
						uniqueKey: "van",
						name: "Campervan",
						description: null,
						iconEmoji: "🚐",
						layout: "basic",
						relationKeys: ["price", "imageUrl"],
					},
				],
				meta,
			}),
		),
		http.get("/api/spaces/space-1/relations", () =>
			HttpResponse.json({
				data: [
					{
						id: "r-price",
						spaceId: "space-1",
						typeId: "type-van",
						uniqueKey: "price",
						format: "number",
						name: "Price per night",
						description: null,
						isReadOnly: false,
						isHidden: false,
						maxCount: null,
					},
					{
						id: "r-image",
						spaceId: "space-1",
						typeId: "type-van",
						uniqueKey: "imageUrl",
						format: "shortText",
						name: "Image",
						description: null,
						isReadOnly: false,
						isHidden: false,
						maxCount: null,
					},
				],
				meta: { ...meta, total: 2 },
			}),
		),
	);
}

// Writes go to the generic object route; the bodies are what the test checks.
function serveWrites() {
	const bodies: unknown[] = [];

	server.use(
		http.patch("/api/objects/van-1", async ({ request }) => {
			bodies.push(await request.json());

			return HttpResponse.json(sierra());
		}),
	);

	return bodies;
}

function renderObjectPage(entry = "/object/van-1?spaceId=space-1") {
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
								<Route path="/object/:objectId" element={<ObjectPage />} />
							</Routes>
						</AuthProvider>
					</LangProvider>
				</ThemeProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

describe("ObjectPage", () => {
	it("opens one object with its type, its values and what links to it", async () => {
		// Arrange
		serveObject();

		// Act
		renderObjectPage();

		// Assert
		expect(
			await screen.findByRole("heading", { name: "Properties" }),
		).toBeInTheDocument();
		expect(await screen.findByText("Campervan")).toBeInTheDocument();
		expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue(
			"Sierra Weekender",
		);
		expect(
			screen.getByRole("textbox", { name: "Price per night" }),
		).toHaveValue("89");
		expect(await screen.findByText("Trip notes")).toBeInTheDocument();
	});

	it("shows the object's image above the fold", async () => {
		// Arrange
		serveObject();

		// Act
		renderObjectPage();

		// Assert — the first image-looking value is the banner
		const image = await screen.findByRole("img");

		expect(image).toHaveAttribute("src", "https://images.example.com/a.jpg");
	});

	it("edits the title and a value back into the object", async () => {
		// Arrange
		serveObject();
		const bodies = serveWrites();

		renderObjectPage();

		// Act
		const title = await screen.findByRole("textbox", { name: "Name" });

		fireEvent.change(title, { target: { value: "Sierra II" } });
		fireEvent.blur(title);

		const price = screen.getByRole("textbox", { name: "Price per night" });

		fireEvent.change(price, { target: { value: "120" } });
		fireEvent.blur(price);

		// Assert — a number is sent as a number, not as text
		await waitFor(() =>
			expect(bodies).toEqual([
				{ name: "Sierra II" },
				{ details: { price: 120 } },
			]),
		);
	});

	it("sends nothing when a field is left as it was", async () => {
		// Arrange
		serveObject();
		const bodies = serveWrites();

		renderObjectPage();

		// Act
		const price = await screen.findByRole("textbox", {
			name: "Price per night",
		});

		fireEvent.blur(price);

		// Assert
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(bodies).toEqual([]);
	});

	it("shows an object's document as its body", async () => {
		// Arrange — the basic layout is the one kind that can hold blocks
		serveObject();
		server.use(
			http.get("/api/objects/van-1/blocks", () =>
				HttpResponse.json({
					data: [
						{
							id: "b-1",
							objectId: "van-1",
							parentId: null,
							type: "text",
							style: "paragraph",
							text: "Book the ferry",
							linkTargetId: null,
							createdAt: "2026-10-01T00:00:00.000Z",
							updatedAt: "2026-10-01T00:00:00.000Z",
						},
					],
				}),
			),
		);

		// Act
		renderObjectPage();

		// Assert
		expect(
			await screen.findByDisplayValue("Book the ferry"),
		).toBeInTheDocument();
	});

	it("keeps a saved view's document off its page", async () => {
		// Arrange
		serveObject();
		let blocksRequested = false;

		server.use(
			http.get("/api/objects/van-1", () =>
				HttpResponse.json({ ...sierra(), resolvedLayout: "dataview" }),
			),
			http.get("/api/objects/van-1/blocks", () => {
				blocksRequested = true;

				return HttpResponse.json({ data: [] });
			}),
		);

		// Act
		renderObjectPage();

		// Assert — a view's body is its records, not a block document
		await screen.findByText("Campervan");

		expect(blocksRequested).toBe(false);
	});
});
