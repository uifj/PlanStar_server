import { afterEach, vi } from "vitest";
import { prismaMock, resetPrismaMocks } from "./mocks/prismaMock.js";

vi.mock("../src/lib/prisma.js", () => ({
	prisma: prismaMock,
}));

afterEach(() => {
	resetPrismaMocks();
	vi.restoreAllMocks();
});
