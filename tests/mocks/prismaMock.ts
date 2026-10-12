import { vi } from "vitest";

function createModelMock() {
	return {
		findUnique: vi.fn(),
		findUniqueOrThrow: vi.fn(),
		findFirst: vi.fn(),
		findMany: vi.fn(),
		create: vi.fn(),
		createMany: vi.fn(),
		update: vi.fn(),
		updateMany: vi.fn(),
		delete: vi.fn(),
		deleteMany: vi.fn(),
		upsert: vi.fn(),
		count: vi.fn(),
		aggregate: vi.fn(),
		groupBy: vi.fn(),
	};
}

export const prismaMock = {
	$queryRaw: vi.fn(),
	$executeRaw: vi.fn(),
	$transaction: vi.fn(),

	// Better Auth
	user: createModelMock(),
	session: createModelMock(),
	account: createModelMock(),
	verification: createModelMock(),
};

export function resetPrismaMocks() {
	for (const value of Object.values(prismaMock)) {
		if (typeof value === "function") {
			value.mockReset();
			continue;
		}

		for (const method of Object.values(value)) {
			method.mockReset();
		}
	}
}
