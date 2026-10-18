import { beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { prisma } from "../../src/lib/prisma.js";
import { signInAs } from "./helpers/auth-session.js";
import { isDatabaseAvailable } from "./helpers/database.js";
import { post } from "./helpers/request.js";

vi.mock("../../src/lib/auth.js", () => ({
	auth: { api: { getSession: vi.fn() }, handler: vi.fn() },
}));

const databaseAvailable = await isDatabaseAvailable();

// HistoryDiffVersions answers with the client's own event list (response.ts:570 reads
// response.historyEvents and maps every entry through Mapper.Event). A changed line that
// still matches a live Block row is pushed as blockSetText with that row's real id; a change
// with no row to attach to becomes one objectDetailsAmend on the snippet, because a made-up
// block id resolves to nothing in the client.
describe.skipIf(!databaseAvailable)("HistoryDiffVersions event model", () => {
	const owner = "histdiff.owner";

	const stateOf = (lines: string[]) => {
		const doc = new Y.Doc();
		doc.getXmlFragment("default").insert(
			0,
			lines.map((line) => new Y.XmlText(line)),
		);
		const state = Buffer.from(Y.encodeStateAsUpdate(doc));
		doc.destroy();
		return state;
	};

	let spaceId = "";
	let objectId = "";

	beforeAll(async () => {
		await prisma.space.deleteMany({ where: { createdBy: owner } });
		await prisma.user.deleteMany({ where: { id: owner } });
		await prisma.user.create({
			data: {
				id: owner,
				name: "History owner",
				email: "histdiff@vanlife.test",
			},
		});

		signInAs(owner);
		spaceId = (
			await (
				await post("/api/command/WorkspaceCreate", {
					details: { name: "History space" },
					useCase: 2,
				})
			).json()
		).spaceId as string;
		objectId = (
			await (
				await post("/api/command/ObjectCreate", {
					spaceId,
					details: { name: "Diffable" },
				})
			).json()
		).objectId as string;
	});

	const addVersions = async (before: string[], after: string[]) => {
		const previous = await prisma.documentVersion.create({
			data: {
				spaceId,
				objectId,
				state: stateOf(before),
				createdAt: new Date(),
			},
			select: { id: true },
		});
		const current = await prisma.documentVersion.create({
			data: {
				spaceId,
				objectId,
				state: stateOf(after),
				createdAt: new Date(Date.now() + 1000),
			},
			select: { id: true },
		});

		signInAs(owner);
		const body = await (
			await post("/api/command/HistoryDiffVersions", {
				objectId,
				spaceId,
				currentVersion: current.id,
				previousVersion: previous.id,
			})
		).json();

		return { previousId: previous.id, currentId: current.id, body };
	};

	it("amends the snippet when no block row can carry the change", async () => {
		const { body } = await addVersions(
			["Alpha", "Beta"],
			["Alpha", "Beta rewritten"],
		);

		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.historyEvents.length).toBe(1);

		const amend = body.historyEvents[0].objectDetailsAmend;
		expect(amend.id).toBe(objectId);
		expect(amend.details[0].key).toBe("snippet");
		expect(amend.details[0].value.stringValue).toBe("Alpha\nBeta rewritten");
	});

	it("pushes blockSetText with the real row id when the line still aligns", async () => {
		const row = await prisma.block.create({
			data: {
				objectId,
				type: "text",
				style: "paragraph",
				text: "Gamma",
				index: "0",
			},
			select: { id: true },
		});

		const { body } = await addVersions(
			["Gamma", "Delta"],
			["Gamma renamed", "Delta"],
		);

		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.historyEvents.length).toBe(1);
		expect(body.historyEvents[0].blockSetText).toEqual({
			id: row.id,
			text: { value: "Gamma renamed" },
		});

		await prisma.block.deleteMany({ where: { id: row.id } });
	});

	it("refuses a caller outside the object's space", async () => {
		const intruder = "histdiff.intruder";
		await prisma.user.deleteMany({ where: { id: intruder } });
		await prisma.user.create({
			data: {
				id: intruder,
				name: "Intruder",
				email: "histdiff-intruder@vanlife.test",
			},
		});

		const { previousId, currentId } = await addVersions(["One"], ["Two"]);

		signInAs(intruder);
		const body = await (
			await post("/api/command/HistoryDiffVersions", {
				objectId,
				spaceId,
				currentVersion: currentId,
				previousVersion: previousId,
			})
		).json();

		expect(body.error).toEqual({
			code: 2,
			description: "Object access denied.",
		});
	});
});
