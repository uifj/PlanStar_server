import { describe, expect, it } from "vitest";

import {
	type DesktopMenuMessageId,
	desktopMenuMessageIds,
	formatDesktopMenuMessage,
	getDesktopMenuMessage,
} from "../menuMessages";

describe("menuMessages", () => {
	const allIds = Object.values(desktopMenuMessageIds) as DesktopMenuMessageId[];

	it("has an en-US string for every message id", () => {
		for (const id of allIds) {
			const value = getDesktopMenuMessage("en-US", id);
			expect(typeof value).toBe("string");
			expect(value.length).toBeGreaterThan(0);
		}
	});

	it("has a zh-CN string for every message id", () => {
		for (const id of allIds) {
			const value = getDesktopMenuMessage("zh-CN", id);
			expect(typeof value).toBe("string");
			expect(value.length).toBeGreaterThan(0);
		}
	});

	it("falls back to en-US for an unknown locale", () => {
		const value = getDesktopMenuMessage(
			"fr-FR" as never,
			desktopMenuMessageIds.file,
		);
		expect(value).toBe(
			getDesktopMenuMessage("en-US", desktopMenuMessageIds.file),
		);
	});

	it("substitutes {appName} via formatDesktopMenuMessage", () => {
		const formatted = formatDesktopMenuMessage(
			"en-US",
			desktopMenuMessageIds.appAbout,
			{
				appName: "Harness",
			},
		);
		expect(formatted).toBe("About Harness");
		expect(formatted).not.toContain("{appName}");
	});

	it("zh-CN appAbout also substitutes {appName}", () => {
		const formatted = formatDesktopMenuMessage(
			"zh-CN",
			desktopMenuMessageIds.appAbout,
			{
				appName: "Harness",
			},
		);
		expect(formatted).toContain("Harness");
		expect(formatted).not.toContain("{appName}");
	});

	it("en-US and zh-CN differ for at least one label", () => {
		// Sanity check: the two tables are not accidental copies.
		const en = getDesktopMenuMessage("en-US", desktopMenuMessageIds.file);
		const zh = getDesktopMenuMessage("zh-CN", desktopMenuMessageIds.file);
		expect(en).not.toBe(zh);
	});
});
