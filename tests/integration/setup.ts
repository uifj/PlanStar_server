import dotenv from "dotenv";
import { afterAll } from "vitest";

dotenv.config({
	path: ".env.test",
});

const { prisma } = await import("../../src/lib/prisma.js");

afterAll(async () => {
	await prisma.$disconnect();
});
