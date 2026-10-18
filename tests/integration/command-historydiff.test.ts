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

// HistoryDiffVersions must key its events by the block ids the client is actually shown.
// history/right.tsx:256 hands the response to history.tsx:53 renderDiff, which resolves every
// event through `#block-<id>` inside the previewed version's block tree — the tree the client
// got from HistoryShowVersion — and for a changed line reads the old text from the SAME id in
// the previous version's context (dispatcher.onObjectView roots that context at
// `<objectId>-<previousVersionId>`). So both previews have to hand out matching line ids, or
// every marker is dropped on the floor and the diff pane shows nothing.
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

	// What the client can resolve: the ids in the previewed version's block tree, and the text
	// each of those blocks carries.
	const showVersion = async (versionId: string) => {
		signInAs(owner);
		const body = await (
			await post("/api/command/HistoryShowVersion", { objectId, versionId })
		).json();
		const blocks = body.objectView.blocks as any[];
		const root = blocks.find((it) => it.id === objectId);
		return {
			lineIds: root.childrenIds as string[],
			texts: new Map(
				blocks
					.filter((it) => it.id !== objectId)
					.map((it) => [it.id, String(it.text?.text ?? "")]),
			),
		};
	};

	it("hands both previews the same line id for the same line position", async () => {
		const { previousId, currentId } = await addVersions(
			["Alpha", "Beta"],
			["Alpha", "Beta rewritten"],
		);

		const before = await showVersion(previousId);
		const after = await showVersion(currentId);

		expect(before.lineIds).toEqual(after.lineIds);
		expect(before.texts.get(before.lineIds[1])).toBe("Beta");
		expect(after.texts.get(after.lineIds[1])).toBe("Beta rewritten");
	});

	it("keys a changed line by an id the previewed version actually renders", async () => {
		const { previousId, currentId } = await addVersions(
			["Alpha", "Beta"],
			["Alpha", "Beta rewritten"],
		);

		const after = await showVersion(currentId);

		signInAs(owner);
		const body = await (
			await post("/api/command/HistoryDiffVersions", {
				objectId,
				spaceId,
				currentVersion: currentId,
				previousVersion: previousId,
			})
		).json();

		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.historyEvents.length).toBe(1);
		expect(body.historyEvents[0].blockSetText).toEqual({
			id: after.lineIds[1],
			text: { value: "Beta rewritten" },
		});
	});
	it("pushes blockAdd for a line only the newer version has", async () => {
		const { previousId, currentId } = await addVersions(
			["Alpha"],
			["Alpha", "Beta added"],
		);

		const before = await showVersion(previousId);
		const after = await showVersion(currentId);

		signInAs(owner);
		const body = await (
			await post("/api/command/HistoryDiffVersions", {
				objectId,
				spaceId,
				currentVersion: currentId,
				previousVersion: previousId,
			})
		).json();

		expect(body.historyEvents.length).toBe(1);

		const added = body.historyEvents[0].blockAdd.blocks;
		expect(added.map((it: any) => it.text.text)).toEqual(["Beta added"]);
		expect(added.map((it: any) => it.id)).toEqual([after.lineIds[1]]);
		expect(before.lineIds).not.toContain(after.lineIds[1]);
	});

	it("narrows the root's children when the newer version dropped a line", async () => {
		const { previousId, currentId } = await addVersions(
			["Alpha", "Beta", "Gamma"],
			["Alpha", "Gamma"],
		);

		const after = await showVersion(currentId);

		signInAs(owner);
		const body = await (
			await post("/api/command/HistoryDiffVersions", {
				objectId,
				spaceId,
				currentVersion: currentId,
				previousVersion: previousId,
			})
		).json();

		expect(body.historyEvents.length).toBe(1);
		expect(body.historyEvents[0].blockSetChildrenIds).toEqual({
			id: objectId,
			childrenIds: after.lineIds,
		});
	});

	it("counts blank lines the same way the preview does", async () => {
		const { previousId, currentId } = await addVersions(
			["Alpha", "", "Beta"],
			["Alpha", "", "Beta moved up"],
		);

		const after = await showVersion(currentId);

		expect(after.lineIds.length).toBe(2);

		signInAs(owner);
		const body = await (
			await post("/api/command/HistoryDiffVersions", {
				objectId,
				spaceId,
				currentVersion: currentId,
				previousVersion: previousId,
			})
		).json();

		expect(body.historyEvents[0].blockSetText.id).toBe(after.lineIds[1]);
	});

	it("leaves a line that only shifted position out of the diff", async () => {
		const { previousId, currentId } = await addVersions(
			["Alpha", "Beta rewritten", "Gamma"],
			["Alpha", "Beta rewritten two ways", "Gamma", "Delta added"],
		);

		const after = await showVersion(currentId);

		signInAs(owner);
		const body = await (
			await post("/api/command/HistoryDiffVersions", {
				objectId,
				spaceId,
				currentVersion: currentId,
				previousVersion: previousId,
			})
		).json();

		const changed = body.historyEvents
			.filter((it: any) => it.blockSetText)
			.map((it: any) => it.blockSetText);

		expect(changed).toEqual([
			{
				id: after.lineIds[1],
				text: { value: "Beta rewritten two ways" },
			},
		]);

		const added = body.historyEvents.find((it: any) => it.blockAdd);
		expect(added.blockAdd.blocks.map((it: any) => [it.id, it.text.text])).toEqual(
			[[after.lineIds[3], "Delta added"]],
		);
	});

	it("answers no events for two versions that read the same", async () => {
		const { previousId, currentId } = await addVersions(
			["Alpha", "Beta"],
			["Alpha", "Beta"],
		);

		signInAs(owner);
		const body = await (
			await post("/api/command/HistoryDiffVersions", {
				objectId,
				spaceId,
				currentVersion: currentId,
				previousVersion: previousId,
			})
		).json();

		expect(body.error).toEqual({ code: 0, description: "" });
		expect(body.historyEvents).toEqual([]);
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
