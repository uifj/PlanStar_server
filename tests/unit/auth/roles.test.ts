import { describe, expect, it } from "vitest";
import { getRoles, isAdmin, isUser, ROLES } from "../../../src/auth/roles.js";
import { user } from "../../helpers/fixtures/auth.js";

describe("roles", () => {
	it("parses comma-separated roles", () => {
		const result = getRoles({
			...user,
			role: "user, admin",
		});

		expect(result).toEqual([ROLES.USER, ROLES.ADMIN]);
	});

	it("ignores empty role entries", () => {
		const result = getRoles({
			...user,
			role: "user, , admin,",
		});

		expect(result).toEqual([ROLES.USER, ROLES.ADMIN]);
	});

	it("detects admin users", () => {
		const result = isAdmin({
			...user,
			role: "user,admin",
		});

		expect(result).toBe(true);
	});

	it("returns false for non-admin users", () => {
		const result = isAdmin({
			...user,
			role: "user",
		});

		expect(result).toBe(false);
	});

	it("detects renter users", () => {
		const result = isUser({
			...user,
			role: "user",
		});

		expect(result).toBe(true);
	});

	it("returns false for non-renter users", () => {
		const result = isUser({
			...user,
			role: "host",
		});

		expect(result).toBe(false);
	});
});
