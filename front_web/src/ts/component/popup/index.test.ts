import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The shell opens these popups by id (`S.Popup.open('feedback' | 'forceUpdate')`) and
 * `popup/index.tsx` answers an unregistered id with "Component not found" — a silent dead end
 * that no type catches, because the id is a plain string on both sides. These guards pin the
 * registry entry and the copy each dialog reads.
 */
const source = (relative: string): string =>
	readFileSync(new URL(relative, import.meta.url), "utf8");

describe("popup registry", () => {
	const popups = source("./index.tsx");

	it("registers the shell-only feedback dialog", () => {
		expect(popups).toMatch(/import PopupFeedback from '\.\/feedback';/);
		expect(popups).toMatch(/\bfeedback:\s+PopupFeedback\b/);
	});

	it("registers the force-update dialog", () => {
		expect(popups).toMatch(/import PopupForceUpdate from '\.\/forceUpdate';/);
		expect(popups).toMatch(/\bforceUpdate:\s+PopupForceUpdate\b/);
	});
});

describe("popup copy", () => {
	const text = JSON.parse(source("../../../json/text.json")) as Record<
		string,
		string
	>;

	const required = [
		"popupFeedbackTitle",
		"popupFeedbackDescription",
		"popupFeedbackPlaceholder",
		"popupFeedbackAttachScreenshot",
		"popupFeedbackSending",
		"popupFeedbackSubmit",
		"popupFeedbackSuccess",
		"popupFeedbackError",
		"popupFeedbackErrorEmpty",
		"popupForceUpdateTitle",
		"popupForceUpdateText",
		"popupForceUpdateButton",
		"popupForceUpdateDownloading",
		"popupForceUpdateInstalling",
		"popupForceUpdateRestart",
		"popupForceUpdateErrorUnavailable",
	];

	it.each(required)("defines %s", (key) => {
		expect(typeof text[key]).toBe("string");
		expect(text[key].length).toBeGreaterThan(0);
	});

	it("keeps the version and progress placeholders the dialogs sprintf into", () => {
		expect(text.popupForceUpdateText).toContain("%s");
		expect(text.popupForceUpdateDownloading).toContain("%s");
	});
});
