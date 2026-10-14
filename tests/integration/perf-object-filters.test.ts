import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { API_PREFIX } from "../../src/config/constants.js";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
		handler: vi.fn(),
	},
}));

const databaseAvailable = await isDatabaseAvailable();
const gateEnabled = process.env.PERF_GATE === "1";

const OBJECT_COUNT = 50_000;
const CHUNK_SIZE = 10_000;
const P95_BUDGET_MS = 20;
const SAMPLES = 25;

const ownerId = "perf.owner";
const directions = ["north", "south", "east", "west"];

let spaceId = "";

const budgetFilter = encodeURIComponent(
	JSON.stringify([{ key: "budget", operator: "greater", value: 100 }]),
);

const { get, post } = await import("./helpers/request.js");

async function seedBenchSpace() {
	await prisma.user.upsert({
		where: { id: ownerId },
		update: {},
		create: {
			id: ownerId,
			name: "Perf Owner",
			email: `${ownerId}@vanlife.test`,
		},
	});

	signInAs(ownerId);

	const space = await post(`${API_PREFIX}/spaces`, { name: "Perf bench" });
	spaceId = (await space.json()).id as string;

	await post(`${API_PREFIX}/spaces/${spaceId}/relations`, {
		uniqueKey: "budget",
		format: "number",
		name: "Budget",
	});
	const type = await post(`${API_PREFIX}/spaces/${spaceId}/object-types`, {
		uniqueKey: "benchThing",
		name: "Bench thing",
		relationKeys: ["budget"],
	});
	const typeId = (await type.json()).id as string;

	for (let start = 0; start < OBJECT_COUNT; start += CHUNK_SIZE) {
		const size = Math.min(CHUNK_SIZE, OBJECT_COUNT - start);

		await prisma.obj.createMany({
			data: Array.from({ length: size }, (_, offset) => {
				const row = start + offset;

				return {
					spaceId,
					typeId,
					creatorId: ownerId,
					name: `Bench ${row}`,
					description: directions[row % directions.length],
					details: { budget: row % 500 },
					updatedAt: new Date(),
				};
			}),
		});
	}

	// The gate measures the planner's choices, so the fresh rows need statistics.
	await prisma.$executeRaw`ANALYZE "Obj"`;
}

function percentile(values: number[], ratio: number) {
	const sorted = [...values].sort((left, right) => left - right);
	const index = Math.min(
		sorted.length - 1,
		Math.ceil(ratio * sorted.length) - 1,
	);

	return sorted[index] as number;
}

describe.skipIf(!databaseAvailable || !gateEnabled)(
	"object filter performance gate",
	() => {
		beforeAll(seedBenchSpace, 300_000);

		afterAll(async () => {
			// The bench space is deleted through the user so the cascade covers it.
			await prisma.user.delete({ where: { id: ownerId } });
		});

		it(`lists objects above a number threshold within ${P95_BUDGET_MS}ms at p95`, async () => {
			// Arrange — warm the cache and settle the plan before measuring
			for (let warm = 0; warm < 3; warm += 1) {
				await get(
					`${API_PREFIX}/spaces/${spaceId}/objects?filters=${budgetFilter}`,
				);
			}

			const durations: number[] = [];

			// Act
			for (let sample = 0; sample < SAMPLES; sample += 1) {
				const startedAt = performance.now();
				const response = await get(
					`${API_PREFIX}/spaces/${spaceId}/objects?filters=${budgetFilter}`,
				);
				durations.push(performance.now() - startedAt);

				expect(response.status).toBe(200);
			}

			const listed = await get(
				`${API_PREFIX}/spaces/${spaceId}/objects?filters=${budgetFilter}`,
			);
			const body = (await listed.json()) as { meta: { total: number } };
			const p50 = Math.round(percentile(durations, 0.5));
			const p95 = Math.round(percentile(durations, 0.95));

			// Assert
			console.info(
				`perf gate: ${OBJECT_COUNT} objects per space, p50=${p50}ms p95=${p95}ms, matched=${body.meta.total}`,
			);

			expect(body.meta.total).toBeGreaterThan(0);
			expect(p95).toBeLessThan(P95_BUDGET_MS);
		}, 120_000);
	},
);
