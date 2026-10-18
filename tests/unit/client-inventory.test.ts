import { describe, expect, it } from "vitest";
import { createFileInventoryIO, extractClientInventory, runClientInventory, serializeClientInventory } from "../../scripts/client-inventory.js";

const commandFile = "front_web/src/ts/lib/api/command.ts";

describe("client capability inventory", () => {
	it("extracts exported wrappers and literal dispatcher names without running frontend code", () => {
		const inventory = extractClientInventory([
			{
				file: commandFile,
				text: [
					"throw new Error('must never execute frontend imports');",
					"// dispatcher.request('NotACommand', {});",
					"export const Open = () => {",
					"  dispatcher.request(",
					"    'ObjectOpen', {});",
					"};",
					"export function Close() { dispatcher.request(`ObjectClose`, {}); }",
				].join("\n"),
			},
		]);
		expect(inventory.capabilities.filter((c) => c.kind === "command-wrapper").map((c) => c.name)).toEqual(["Close", "Open"]);
		expect(inventory.capabilities.filter((c) => c.kind === "dispatcher-command").map((c) => c.name)).toEqual(["ObjectClose", "ObjectOpen"]);
		expect(inventory.capabilities.find((c) => c.id === "dispatcher-command:ObjectOpen")).toMatchObject({
			target: null,
			status: "pending",
			references: [{ file: commandFile, line: 4, column: 3, wrapper: "Open" }],
		});
	});

	it("keeps registry-only RPCs and streams, and reports observed name drift without inventing aliases", () => {
		const inventory = extractClientInventory([
			{ file: commandFile, text: `
export const ObjectTypeRelationAdd = () => dispatcher.request('ObjectTypeRelationAdd', {});
export const ObjectTypeRelationRemove = () => dispatcher.request('ObjectTypeRelationRemove', {});
export const DebugExportLog = () => dispatcher.request('DebugExportLog', {});
export const FriendlyName = () => dispatcher.request('ActualName', {});
` },
			{ file: "front_web/src/ts/lib/api/service.ts", text: `
const registry = {
  ObjectTypePropertyAdd: { req: Commands.Add, res: Commands.AddResponse },
  ObjectTypePropertyRemove: { req: Commands.Remove, res: Commands.RemoveResponse },
  LogSend: { req: Commands.Log, res: Commands.LogResponse },
  RegistryOnly: { req: Commands.Hidden, res: Commands.HiddenResponse },
};` },
			{ file: "front_web/dist/lib/protos/service.proto", text: `
service ClientCommands {
  // rpc Fake (Request) returns (Response);
  rpc ObjectTypePropertyAdd (Request) returns (Response);
  rpc ObjectTypePropertyRemove (Request) returns (Response);
  rpc LogSend (Request) returns (Response);
  rpc RegistryOnly (Request) returns (Response);
  rpc ListenSessionEvents (StreamRequest) returns (stream Event);
}` },
		]);
		expect(inventory.capabilities.find((c) => c.id === "proto-rpc:ListenSessionEvents")).toMatchObject({ protocol: "grpc-web/server-stream", status: "pending" });
		expect(inventory.capabilities.find((c) => c.id === "registry-command:RegistryOnly")).toBeDefined();
		expect(inventory.capabilities.some((c) => c.name === "Fake")).toBe(false);
		expect(inventory.drift.registryWithoutLiteralDispatch).toContain("RegistryOnly");
		expect(inventory.drift.protoUnaryWithoutRegistry).toEqual([]);
		expect(inventory.drift.dispatchWithoutRegistry).toEqual(["ActualName", "DebugExportLog", "ObjectTypeRelationAdd", "ObjectTypeRelationRemove"]);
		expect(inventory.drift.wrapperRequestNameDifferences).toContainEqual({ wrapper: "FriendlyName", request: "ActualName" });
		expect(inventory.drift.nameComparisons.map((d) => [d.dispatch, d.declaration, d.status])).toEqual([
			["DebugExportLog", "LogSend", "needs-review"],
			["ObjectTypeRelationAdd", "ObjectTypePropertyAdd", "needs-review"],
			["ObjectTypeRelationRemove", "ObjectTypePropertyRemove", "needs-review"],
		]);
		expect(inventory.capabilities.every((c) => c.target === null && ["pending", "needs-review"].includes(c.status))).toBe(true);
	});

	it("records actual C and native use-sites while flagging computed calls instead of guessing them", () => {
		const file = "front_web/src/ts/screen.tsx";
		const inventory = extractClientInventory([{ file, text: [
			"C.Open(); C['Close'](); const callback = C.Open;",
			"C[commandName](); dispatcher.request(commandName, {});",
			"Renderer.send('openPath', path); Renderer.on('route', handler);",
			"Renderer.sendIpc(channel); electron.fileWrite('x', bytes);",
			"U.Common.getElectron().showOpenDialog({});",
			"// C.CommentOnly(); Renderer.send('notReal');",
		].join("\n") }]);
		expect(inventory.capabilities.find((c) => c.id === "command-use:Open")?.references).toMatchObject([
			{ file, line: 1, usage: "call" }, { file, line: 1, usage: "reference" },
		]);
		expect(inventory.capabilities.find((c) => c.id === "command-use:Close")).toBeDefined();
		expect(inventory.capabilities.find((c) => c.id === "renderer-command:openPath")).toBeDefined();
		expect(inventory.capabilities.find((c) => c.id === "renderer-event:route")).toBeDefined();
		expect(inventory.capabilities.filter((c) => c.kind === "native-method").map((c) => c.name)).toEqual(["fileWrite", "showOpenDialog"]);
		expect(inventory.unresolved.map((u) => u.reference.expression)).toEqual(["C[commandName]", "commandName", "channel"]);
		expect(inventory.unresolved.every((u) => u.status === "needs-review")).toBe(true);
		expect(inventory.capabilities.some((c) => c.name === "CommentOnly" || c.name === "notReal")).toBe(false);
	});

	it("inventories event mappers, generated event types and fields, and dynamic event selection", () => {
		const inventory = extractClientInventory([
			{ file: "front_web/src/ts/lib/api/mapper.ts", text: `
export const Mapper = {
  From: { NotAnEvent: (data) => data },
  Event: { Type(message) { return key; }, Data: (message) => message,
    AccountShow: (data) => data, BlockAdd(data) { return data; } }
};` },
			{ file: "front_web/middleware/pb/protos/events.ts", text: `
export interface Event_Message { spaceId: string; accountShow?: Event_Account_Show | undefined; }
export interface Event_Account_Show { account: Account; }` },
			{ file: "front_web/src/ts/lib/api/dispatcher.ts", text: `
const mapped = Mapper.Event[type](data);
switch (type) { case 'AccountShow': break; }
` },
		]);
		expect(inventory.capabilities.filter((c) => c.kind === "event-mapper").map((c) => c.name)).toEqual(["AccountShow", "BlockAdd"]);
		expect(inventory.capabilities.filter((c) => c.kind === "event-mapper-helper").map((c) => c.name)).toEqual(["Data", "Type"]);
		expect(inventory.capabilities.find((c) => c.id === "event-type:Event_Account_Show")).toBeDefined();
		expect(inventory.capabilities.find((c) => c.id === "event-field:accountShow")?.references[0].expression).toBe("accountShow?: Event_Account_Show | undefined;");
		expect(inventory.capabilities.find((c) => c.id === "event-handler:AccountShow")).toBeDefined();
		expect(inventory.unresolved).toMatchObject([{ kind: "event-selection", reference: { expression: "Mapper.Event[type]" } }]);
	});

	it("records transport, media, route and native-handler evidence without guessed endpoint mappings", () => {
		const inventory = extractClientInventory([
			{ file: "front_web/src/ts/network.tsx", text: `
fetch('/api/web-upload', { method: 'POST' }); window.fetch(url);
new WebSocket(connectUrl, 'onboarding'); new URL('/socket', base);
S.Common.fileUrl(id); S.Common.imageUrl(id, 100);
U.Router.go('/auth/select', {}); U.Router.go(nextRoute, {});
const view = <Route path={dynamicPath} />;
` },
			{ file: "front_web/src/ts/store/common.ts", text: `
class Store { fileUrl(id) { return [this.gateway, 'file', id].join('/'); }
imageUrl(id) { return [this.gateway, 'image', id].join('/') + '?width=100'; } }
` },
			{ file: "front_web/src/json/route.ts", text: "export default ['/', '/:page/:action/:id?'];" },
			{ file: "front_web/src/ts/component/page/index.tsx", text: "const Components = { 'auth/select': PageAuthSelect, 'main/edit': PageMainEdit };" },
			{ file: "front_web/src/ts/lib/web/electronMock.ts", text: "handlers.set('openPath', () => true); handlers.set(cmd, handler);" },
		]);
		expect(inventory.capabilities.find((c) => c.id === "http-fetch:/api/web-upload")).toMatchObject({ references: [{ method: "POST" }], status: "pending" });
		expect(inventory.capabilities.find((c) => c.id === "websocket:connectUrl")).toMatchObject({ status: "needs-review", target: null });
		expect(inventory.capabilities.find((c) => c.id === "media-gateway-path:fileUrl")?.references[0].expression).toBe("[this.gateway, 'file', id].join('/')");
		expect(inventory.capabilities.find((c) => c.id === "media-use:imageUrl")).toBeDefined();
		expect(inventory.capabilities.filter((c) => c.kind === "page-route").map((c) => c.name)).toEqual(["auth/select", "main/edit"]);
		expect(inventory.capabilities.filter((c) => c.kind === "route-pattern").map((c) => c.name)).toEqual(["/", "/:page/:action/:id?"]);
		expect(inventory.capabilities.find((c) => c.id === "native-handler:openPath")).toMatchObject({ status: "pending" });
		expect(inventory.unresolved.map((u) => u.reference.expression)).toEqual(expect.arrayContaining(["url", "connectUrl", "nextRoute", "dynamicPath", "cmd"]));
	});

	it("generates deterministic JSON and checks source/manifest drift without writing in check mode", async () => {
		const sources = [
			{ file: commandFile, text: "export const Open = () => dispatcher.request('Open', {});" },
			{ file: "front_web/src/ts/z.ts", text: "C.Open();" },
		];
		const generated = serializeClientInventory(extractClientInventory(sources));
		expect(serializeClientInventory(extractClientInventory([...sources].reverse()))).toBe(generated);
		let committed: string | undefined;
		let writes = 0;
		const messages: string[] = [];
		const io = {
			loadSources: async () => sources,
			readManifest: async () => committed,
			writeManifest: async (text: string) => { committed = text; writes++; },
			report: (message: string) => { messages.push(message); },
		};
		expect(await runClientInventory(["--check"], io)).toBe(1);
		expect(writes).toBe(0);
		expect(await runClientInventory([], io)).toBe(0);
		expect(committed).toBe(generated);
		expect(await runClientInventory(["--check"], io)).toBe(0);
		committed = committed!.replace('"pending"', '"complete"');
		expect(await runClientInventory(["--check"], io)).toBe(1);
		committed = generated;
		// Even a change outside the recognized capability syntax invalidates the snapshot.
		sources[1].text += "\n// changed source";
		expect(await runClientInventory(["--check"], io)).toBe(1);
		expect(writes).toBe(1);
		expect(messages.join("\n")).toMatch(/drift/i);
	});

	it("fails closed on incomplete traversal, malformed input or ambiguous source identity before writing", async () => {
		let writes = 0;
		const fixture = { file: commandFile, text: "export const Broken = (" };
		const messages: string[] = [];
		const io = {
			loadSources: async () => [fixture],
			readManifest: async () => "previous reviewed artifact",
			writeManifest: async () => { writes++; },
			report: (message: string) => { messages.push(message); },
		};
		expect(await runClientInventory([], io)).toBe(2);
		expect(writes).toBe(0);
		expect(messages.join("\n")).toContain(commandFile);
		expect(await runClientInventory([], { ...io, loadSources: async () => { throw new Error("Traversal failed"); } })).toBe(2);
		expect(await runClientInventory(["--typo"], io)).toBe(2);
		expect(writes).toBe(0);
		expect(() => extractClientInventory([{ file: "front_web/dist/lib/protos/service.proto", text: "service X { rpc Broken (Req) returns; }" }])).toThrow(/Unparsed RPC/);
		const valid = { file: commandFile, text: "export const Open = () => {};" };
		expect(() => extractClientInventory([valid, valid])).toThrow(/Duplicate/);
		expect(() => extractClientInventory([{ ...valid, file: "../outside.ts" }])).toThrow(/relative/);
	});

	it("traverses real source locations read-only with provenance and explicit non-exhaustive coverage", async () => {
		const io = createFileInventoryIO();
		const sources = await io.loadSources();
		expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining([
			commandFile, "front_web/src/ts/lib/api/service.ts", "front_web/dist/lib/protos/service.proto",
			"front_web/middleware/pb/protos/events.ts", "front_web/src/json/route.ts",
		]));
		expect(sources.some((s) => /\.(test|spec|stories)\./.test(s.file))).toBe(false);
		const inventory = extractClientInventory(sources);
		expect(inventory.coverage.exhaustive).toBe(false);
		expect(inventory.sources.find((s) => s.file === commandFile)?.sha256).toMatch(/^[a-f0-9]{64}$/);
		let writes = 0;
		expect(await runClientInventory(["--check"], {
			...io,
			readManifest: async () => undefined,
			writeManifest: async () => { writes++; },
			report: () => {},
		})).toBe(1);
		expect(writes).toBe(0);
	});
});
