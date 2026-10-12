import { prisma } from "../../../src/lib/prisma.js";

export async function isDatabaseAvailable() {
	try {
		await prisma.$queryRaw`SELECT 1`;
		return true;
	} catch {
		return false;
	}
}

export async function resetDatabase() {
	await prisma.$transaction([
		prisma.session.deleteMany(),
		prisma.account.deleteMany(),
		prisma.verification.deleteMany(),
		prisma.user.deleteMany(),
	]);
}
