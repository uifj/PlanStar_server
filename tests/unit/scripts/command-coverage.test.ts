import { describe, expect, it } from "vitest";
import { extractClientInventory } from "../../../scripts/client-inventory.js";
import {
	collectCommandCoverage,
	runCommandCoverage,
} from "../../../scripts/command-coverage.js";

const clientSources = (names: string[], used: string[]) => [
	{
		file: "front_web/src/ts/lib/api/command.ts",
		text: names
			.map((n) => `export const ${n} = () => dispatcher.request('${n}', {});`)
			.join("\n"),
	},
	{
		file: "front_web/src/ts/lib/used.ts",
		text: `const run = () => { ${used.map((n) => `C.${n}({});`).join(" ")} };`,
	},
];

const coverageOf = (
	names: string[],
	used: string[],
	server: { file: string; text: string }[],
) =>
	collectCommandCoverage(
		extractClientInventory(clientSources(names, used)),
		server,
	);

describe("command coverage join", () => {
	it("splits the client's command surface into answered, unanswered and unreached", () => {
		const coverage = coverageOf(
			["ObjectOpen", "ObjectShow", "ObjectHide"],
			["ObjectOpen", "ObjectShow", "ObjectHide"],
			[
				{
					file: "src/modules/command/service.ts",
					text: `switch (name) { case "ObjectOpen": return OK; }`,
				},
			],
		);

		expect(coverage).toMatchObject({ declared: 3, called: 3, answered: 1 });
		expect(coverage.calledButUnanswered).toEqual(["ObjectHide", "ObjectShow"]);
		expect(coverage.answeredButUncalled).toEqual([]);
	});

	it("counts a name-only router branch as answered", () => {
		const coverage = coverageOf(
			["AccountStop"],
			["AccountStop"],
			[
				{
					file: "src/modules/command/router.ts",
					text: `if (name === "AccountStop") { return revoke(); }`,
				},
			],
		);

		expect(coverage.answeredNames).toEqual(["AccountStop"]);
		expect(coverage.calledButUnanswered).toEqual([]);
	});

	it("keeps non-command switch arms out of the answered set", () => {
		const coverage = coverageOf(
			["ObjectShow"],
			["ObjectShow"],
			[
				{
					file: "src/modules/command/service.ts",
					text: `switch (name) { case "ObjectShow": return OK; }
					switch (format) { case "Markdown": return md; case "isArchived": return flag; }`,
				},
			],
		);

		expect(coverage.answeredNames).toEqual(["ObjectShow"]);
		expect(coverage.answeredWithoutCommand).toEqual(["Markdown"]);
	});

	it("reports computed dispatch instead of pretending the counts are exhaustive", () => {
		const coverage = collectCommandCoverage(
			extractClientInventory([
				{
					file: "front_web/src/ts/lib/api/command.ts",
					text: `export const BlockCopy = () => dispatcher.request('BlockCopy', {});`,
				},
				{
					file: "front_web/src/ts/lib/action.ts",
					text: `const cmd = 'BlockCopy'; C[cmd](ids);`,
				},
			]),
			[
				{
					file: "src/modules/command/service.ts",
					text: `switch (name) { case "BlockCopy": return OK; }`,
				},
			],
		);

		expect(coverage.computedDispatch).toBe(1);
		expect(coverage.calledButUnanswered).toEqual([]);
		// The literal call-site scan cannot see C[cmd](), so this is a review hint, not a verdict.
		expect(coverage.answeredButUncalled).toEqual(["BlockCopy"]);
	});

	it("prints the split and fails closed on unreadable inputs", async () => {
		const lines: string[] = [];
		const io = {
			readClientSources: async () =>
				clientSources(
					["ObjectOpen", "ObjectShow"],
					["ObjectOpen", "ObjectShow"],
				),
			readServerSources: async () => [
				{
					file: "src/modules/command/service.ts",
					text: `switch (name) { case "ObjectOpen": return OK; }`,
				},
			],
			report: (message: string) => lines.push(message),
		};

		expect(await runCommandCoverage([], io)).toBe(0);
		expect(lines.join("\n")).toContain("1 of 2 called commands are unanswered");

		expect(
			await runCommandCoverage(["--json"], {
				...io,
				readServerSources: async () => {
					throw new Error("no such directory");
				},
			}),
		).toBe(2);
	});
});
