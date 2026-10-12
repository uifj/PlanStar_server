import type { Van } from "../../../../src/generated/prisma/client.js";

export function vanFixture(overrides: Partial<Van> = {}): Van {
	return {
		id: "van-1",
		hostId: "host-1",
		name: "Moab Trailhouse",
		price: 129,
		description: "Rugged rig for slickrock loops.",
		imageUrl: "https://images.example.test/moab.jpg",
		type: "rugged",
		location: "Moab, UT",
		sleeps: 2,
		rating: 4.5,
		amenities: [],
		archivedAt: null,
		createdAt: new Date("2026-08-10T00:00:00.000Z"),
		updatedAt: new Date("2026-08-10T00:00:00.000Z"),
		...overrides,
	};
}
