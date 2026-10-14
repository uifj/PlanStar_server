import { UserFacingError, z } from "genkit";
import type { GenkitBeta } from "genkit/beta";
import type { AuthUser } from "../../lib/auth.js";
import { bookingService } from "../bookings/service.js";
import type { CatalogVan } from "../vanlife/catalog.js";
import { vanLifeService } from "../vanlife/service.js";
import { agentSessionService } from "./actor.js";

function toToolVan(van: CatalogVan) {
	return {
		id: van.id,
		name: van.name,
		price: van.price,
		location: van.location,
		sleeps: van.sleeps,
		type: van.type,
		rating: van.rating,
	};
}

interface Conversation {
	actor: AuthUser;
	spaceId: string;
}

// ADR-0011: a tool learns who is speaking from the conversation row through a
// service, never from the table and never from whatever the model asks for.
async function currentConversation(ai: GenkitBeta): Promise<Conversation> {
	const session = await agentSessionService.findSession(
		ai.currentSession().sessionId,
	);

	if (!session) {
		throw new UserFacingError(
			"UNAUTHENTICATED",
			"This conversation is not linked to a traveller.",
		);
	}

	return session;
}

export function createAgentTools(ai: GenkitBeta) {
	const searchVansTool = ai.defineTool(
		{
			name: "searchVans",
			description:
				"Find listed vans to rent, optionally narrowed by location and a nightly budget. Returns the closest matches only.",
			inputSchema: z.object({
				location: z
					.string()
					.optional()
					.describe("City or region, e.g. 'Moab, UT'."),
				maxPrice: z
					.number()
					.int()
					.positive()
					.optional()
					.describe("Highest nightly price the traveller is willing to pay."),
				limit: z
					.number()
					.int()
					.min(1)
					.max(10)
					.default(5)
					.describe("How many vans to return at most."),
			}),
			outputSchema: z.object({
				vans: z.array(
					z.object({
						id: z.string(),
						name: z.string(),
						price: z.number(),
						location: z.string(),
						sleeps: z.number(),
						type: z.string(),
						rating: z.number(),
					}),
				),
			}),
		},
		async ({ location, maxPrice, limit }) => {
			const { actor, spaceId } = await currentConversation(ai);
			const vans = await vanLifeService.searchListedVans(actor, spaceId, {
				location,
				maxPrice,
				limit,
			});

			return { vans: vans.map(toToolVan) };
		},
	);

	const checkAvailabilityTool = ai.defineTool(
		{
			name: "checkAvailability",
			description:
				"Check whether a van can be booked for a date range. When it cannot, the blocking dates are returned so an alternative can be suggested.",
			inputSchema: z.object({
				vanId: z.string().describe("The van to check."),
				startDate: z
					.string()
					.date()
					.describe("First night of the trip as an ISO date, e.g. 2026-09-01."),
				endDate: z
					.string()
					.date()
					.describe("Day the trip ends as an ISO date, e.g. 2026-09-05."),
			}),
			outputSchema: z.object({
				available: z.boolean(),
				reason: z.enum(["available", "not_listed", "date_taken"]),
				conflict: z
					.object({
						startDate: z.string(),
						endDate: z.string(),
					})
					.nullable(),
			}),
		},
		async ({ vanId, startDate, endDate }) => {
			const { actor, spaceId } = await currentConversation(ai);
			const van = await vanLifeService.findListedVan(actor, spaceId, vanId);

			if (!van) {
				return {
					available: false,
					reason: "not_listed" as const,
					conflict: null,
				};
			}

			const conflict = await bookingService.findConflictingBooking(
				vanId,
				new Date(startDate),
				new Date(endDate),
			);

			if (!conflict) {
				return {
					available: true,
					reason: "available" as const,
					conflict: null,
				};
			}

			return {
				available: false,
				reason: "date_taken" as const,
				conflict,
			};
		},
	);

	const myUpcomingTripsTool = ai.defineTool(
		{
			name: "myUpcomingTrips",
			description:
				"List the upcoming trips of the traveller using this conversation. Takes no arguments: the traveller comes from the conversation itself.",
			inputSchema: z.object({}),
			outputSchema: z.object({
				trips: z.array(
					z.object({
						id: z.string(),
						vanName: z.string(),
						startDate: z.string(),
						endDate: z.string(),
						status: z.string(),
					}),
				),
			}),
		},
		async () => {
			const { actor } = await currentConversation(ai);
			const bookings = await bookingService.findUpcoming(actor);

			return {
				trips: bookings.map((booking) => ({
					id: booking.id,
					vanName: booking.van.name,
					startDate: booking.startDate,
					endDate: booking.endDate,
					status: booking.status,
				})),
			};
		},
	);

	return { searchVansTool, checkAvailabilityTool, myUpcomingTripsTool };
}
