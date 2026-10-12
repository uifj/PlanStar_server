import { UserFacingError, z } from "genkit";
import type { GenkitBeta } from "genkit/beta";
import type { Van } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { ACTIVE_BOOKING_STATUSES } from "../bookings/constants.js";

function toDateOnly(date: Date) {
	return date.toISOString().slice(0, 10);
}

function toToolVan(van: Van) {
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
			const vans = await prisma.van.findMany({
				where: {
					archivedAt: null,
					...(location
						? { location: { contains: location, mode: "insensitive" } }
						: {}),
					...(maxPrice ? { price: { lte: maxPrice } } : {}),
				},
				orderBy: { createdAt: "desc" },
				take: limit,
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
			const van = await prisma.van.findFirst({
				where: {
					id: vanId,
					archivedAt: null,
				},
				select: { id: true },
			});

			if (!van) {
				return {
					available: false,
					reason: "not_listed" as const,
					conflict: null,
				};
			}

			const conflict = await prisma.booking.findFirst({
				where: {
					vanId,
					status: {
						in: ACTIVE_BOOKING_STATUSES,
					},
					startDate: { lt: new Date(endDate) },
					endDate: { gt: new Date(startDate) },
				},
				select: { startDate: true, endDate: true },
			});

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
				conflict: {
					startDate: toDateOnly(conflict.startDate),
					endDate: toDateOnly(conflict.endDate),
				},
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
			const chat = await prisma.agentChat.findUnique({
				where: { id: ai.currentSession().sessionId },
			});

			if (!chat) {
				throw new UserFacingError(
					"UNAUTHENTICATED",
					"This conversation is not linked to a traveller.",
				);
			}

			const bookings = await prisma.booking.findMany({
				where: {
					userId: chat.userId,
					startDate: { gte: new Date() },
				},
				orderBy: { startDate: "asc" },
				include: {
					van: {
						select: { name: true },
					},
				},
			});

			return {
				trips: bookings.map((booking) => ({
					id: booking.id,
					vanName: booking.van.name,
					startDate: toDateOnly(booking.startDate),
					endDate: toDateOnly(booking.endDate),
					status: booking.status,
				})),
			};
		},
	);

	return { searchVansTool, checkAvailabilityTool, myUpcomingTripsTool };
}
