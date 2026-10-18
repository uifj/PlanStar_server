import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// Root TypeScript 7 does not expose the synchronous compiler API. Use the
// already-installed frontend TypeScript 5 tooling, never frontend application imports.
import ts from "../front_web/node_modules/typescript/lib/typescript.js";

export interface InventorySource {
	/** Repository-relative POSIX path; source text is parsed, never imported. */
	file: string;
	text: string;
}

export interface Reference {
	file: string;
	line: number;
	column: number;
	wrapper?: string;
	expression?: string;
	usage?: "call" | "reference";
	method?: string;
}

export interface Unresolved {
	kind: string;
	status: "needs-review";
	reason: string;
	reference: Reference;
}

export interface Capability {
	id: string;
	kind: string;
	name: string;
	protocol: string;
	target: null;
	status: "pending" | "needs-review";
	references: Reference[];
}

const COMMAND = "front_web/src/ts/lib/api/command.ts";
const SERVICE = "front_web/src/ts/lib/api/service.ts";
const PROTO = "front_web/dist/lib/protos/service.proto";
const MAPPER = "front_web/src/ts/lib/api/mapper.ts";
const EVENTS = "front_web/middleware/pb/protos/events.ts";
const DISPATCHER = "front_web/src/ts/lib/api/dispatcher.ts";
const ROUTES = "front_web/src/json/route.ts";
const PAGES = "front_web/src/ts/component/page/index.tsx";
const COMMON = "front_web/src/ts/store/common.ts";
const NATIVE = "front_web/src/ts/lib/web/electronMock.ts";
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const literal = (node: ts.Node | undefined): string | undefined =>
	node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
const exported = (node: ts.Node) =>
	ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** Pure extraction seam. No frontend module is executed. */
export function extractClientInventory(sources: readonly InventorySource[]) {
	const seen = new Set<string>();
	for (const { file } of sources) {
		if (!file || file.startsWith("/") || file.includes("\\") || file.split("/").some((part) => ["", ".", ".."].includes(part))) throw new Error(`Expected repository-relative POSIX source path: ${file}`);
		if (seen.has(file)) throw new Error(`Duplicate source path: ${file}`);
		seen.add(file);
	}
	const capabilities = new Map<string, Capability>();
	const unresolved: Unresolved[] = [];
	const record = (kind: string, name: string, reference: Reference, protocol = "grpc-web", status: Capability["status"] = "pending") => {
		const id = `${kind}:${name}`;
		const entry: Capability = capabilities.get(id) ?? {
			id, kind, name, protocol, target: null, status, references: [],
		};
		if (status === "needs-review") entry.status = status;
		entry.references.push(reference);
		capabilities.set(id, entry);
	};
	for (const source of [...sources].sort((a, b) => compare(a.file, b.file))) {
		if (source.file === PROTO) {
			// A narrow proto RPC scanner, not a full protobuf parser. Mask comments and
			// strings without changing offsets so commented examples cannot become RPCs.
			const masked = source.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|"(?:\\.|[^"\\])*"/g,
				(text) => text.replace(/[^\r\n]/g, " "));
			const rpc = /\brpc\s+(\w+)\s*\(\s*(stream\s+)?([\w.]+)\s*\)\s*returns\s*\(\s*(stream\s+)?([\w.]+)\s*\)/g;
			const matches = [...masked.matchAll(rpc)];
			if (matches.length !== [...masked.matchAll(/\brpc\b/g)].length) throw new Error(`Unparsed RPC in ${source.file}`);
			for (const match of matches) {
				const before = source.text.slice(0, match.index);
				const line = before.split("\n").length;
				const column = before.length - before.lastIndexOf("\n");
				record("proto-rpc", match[1], { file: source.file, line, column, expression: source.text.slice(match.index, match.index + match[0].length) },
					match[2] ? (match[4] ? "grpc-web/bidi-stream" : "grpc-web/client-stream") : match[4] ? "grpc-web/server-stream" : "grpc-web/unary");
			}
			continue;
		}
		const ast = ts.createSourceFile(source.file, source.text, ts.ScriptTarget.Latest, true);
		// The parser exposes diagnostics on SourceFile at runtime (not in its public type).
		const diagnostics = (ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
		if (diagnostics.length) throw new Error(`${source.file}: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, " ")}`);
		const ref = (node: ts.Node): Reference => {
			const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
			return { file: source.file, line: position.line + 1, column: position.character + 1 };
		};
		const add = (kind: string, name: string, node: ts.Node, wrapper?: string) =>
			record(kind, name, { ...ref(node), ...(wrapper ? { wrapper } : {}) });
		const unknown = (kind: string, node: ts.Node, reason = "Computed expression; no data-flow or alias resolution is attempted.") =>
			unresolved.push({ kind, status: "needs-review", reason, reference: { ...ref(node), expression: node.getText(ast) } });
		const namedCall = (kind: string, node: ts.CallExpression, argument: number, protocol: string) => {
			const value = node.arguments[argument];
			const name = literal(value);
			if (name === undefined) unknown(kind, value ?? node.expression);
			else record(kind, name, { ...ref(node), expression: node.expression.getText(ast) }, protocol);
		};
		const pathEvidence = (kind: string, value: ts.Node, site: ts.Node, protocol: string, extra: Partial<Reference> = {}) => {
			const name = literal(value);
			if (name !== undefined || kind !== "route-pattern") record(kind, name ?? value.getText(ast), { ...ref(site), expression: value.getText(ast), ...extra }, protocol, name === undefined ? "needs-review" : "pending");
			if (name === undefined) unknown(kind, value, "Runtime path/URL; expression retained, no resolved endpoint asserted.");
		};
		const visit = (node: ts.Node, wrapper?: string) => {
			if (source.file === ROUTES && ts.isExportAssignment(node) && ts.isArrayLiteralExpression(node.expression)) {
				for (const path of node.expression.elements) pathEvidence("route-pattern", path, path, "client-router");
			}
			if (source.file === PAGES && ts.isVariableDeclaration(node) && node.name.getText(ast) === "Components" &&
				node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
				for (const property of node.initializer.properties) {
					if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
						record("page-route", literal(property.name) ?? property.name.getText(ast), { ...ref(property), expression: property.initializer.getText(ast) }, "client-router");
					} else unknown("page-route", property);
				}
			}
			if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
				if (node.tagName.getText(ast) === "Route") {
					for (const attribute of node.attributes.properties) {
						if (ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "path" && attribute.initializer) {
							const value = ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer;
							if (value) pathEvidence("route-pattern", value, attribute, "client-router");
						}
					}
				}
			}
			if (source.file === COMMON && ts.isMethodDeclaration(node) && ["fileUrl", "imageUrl"].includes(node.name.getText(ast))) {
				const returns = (child: ts.Node) => {
					if (ts.isReturnStatement(child) && child.expression) {
						record("media-gateway-path", node.name.getText(ast), { ...ref(child), expression: child.expression.getText(ast) }, "http/media-gateway", "needs-review");
					} else ts.forEachChild(child, returns);
				};
				if (node.body) returns(node.body);
			}
			if (ts.isCallExpression(node) && ["fetch", "window.fetch", "globalThis.fetch"].includes(node.expression.getText(ast))) {
				const options = node.arguments[1];
				const method = options && ts.isObjectLiteralExpression(options) ? options.properties.find((p) => ts.isPropertyAssignment(p) && (literal(p.name) ?? p.name.getText(ast)) === "method") : undefined;
				const methodName = method && ts.isPropertyAssignment(method) ? literal(method.initializer) ?? method.initializer.getText(ast) : options ? "unknown" : "GET";
				if (node.arguments[0]) pathEvidence("http-fetch", node.arguments[0], node, "http", { method: methodName });
			}
			if (ts.isNewExpression(node) && ["WebSocket", "window.WebSocket", "URL", "EventSource"].includes(node.expression.getText(ast)) && node.arguments?.[0]) {
				const constructor = node.expression.getText(ast).replace(/^window\./, "");
				pathEvidence(constructor === "WebSocket" ? "websocket" : constructor === "EventSource" ? "event-source" : "url-construction", node.arguments[0], node, constructor === "WebSocket" ? "websocket" : "url");
			}
			if (source.file === EVENTS && ts.isInterfaceDeclaration(node) && /^Event(?:_|$)/.test(node.name.text)) {
				record("event-type", node.name.text, ref(node), "protobuf/event");
				if (node.name.text === "Event_Message") {
					for (const member of node.members) {
						if (ts.isPropertySignature(member) && member.questionToken && member.name) {
							record("event-field", literal(member.name) ?? member.name.getText(ast), { ...ref(member), expression: member.getText(ast) }, "protobuf/event");
						}
					}
				}
			}
			if (source.file === MAPPER && ts.isPropertyAssignment(node) && node.name.getText(ast) === "Event" &&
				ts.isObjectLiteralExpression(node.initializer)) {
				for (const member of node.initializer.properties) {
					if ((ts.isPropertyAssignment(member) || ts.isMethodDeclaration(member)) && !ts.isComputedPropertyName(member.name)) {
						const name = literal(member.name) ?? member.name.getText(ast);
						record(["Type", "Data"].includes(name) ? "event-mapper-helper" : "event-mapper", name, ref(member), "protobuf/event");
					} else unknown("event-mapper", member);
				}
			}
			if (source.file === DISPATCHER && ts.isCaseClause(node) && ts.isSwitchStatement(node.parent.parent) &&
				node.parent.parent.expression.getText(ast) === "type") {
				const name = literal(node.expression);
				if (name) record("event-handler", name, ref(node), "protobuf/event");
			}
			if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
				if (ts.isElementAccessExpression(node) && node.expression.getText(ast) === "Mapper.Event" && literal(node.argumentExpression) === undefined) {
					unknown("event-selection", node);
				}

				if (node.expression.getText(ast) === "C") {
					const name = ts.isPropertyAccessExpression(node) ? node.name.text : literal(node.argumentExpression);
					if (name === undefined) unknown("command-use", node);
					else record("command-use", name, { ...ref(node), usage: ts.isCallExpression(node.parent) && node.parent.expression === node ? "call" : "reference" });
				}
			}
			if (ts.isCallExpression(node) && (ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression))) {
				const access = node.expression;
				const owner = access.expression.getText(ast);
				const method = ts.isPropertyAccessExpression(access) ? access.name.text : literal(access.argumentExpression);
				if (owner === "U.Router" && method === "go" && node.arguments[0]) pathEvidence("route-use", node.arguments[0], node, "client-router");
				if (owner === "S.Common" && ["fileUrl", "imageUrl"].includes(method ?? "")) record("media-use", method!, ref(node), "http/media-gateway");
				if (source.file === NATIVE && owner === "handlers" && method === "set") namedCall("native-handler", node, 0, "web-native-shim");
				if (owner === "Renderer") {
					if (["send", "sendIpc", "on", "remove"].includes(method ?? "")) {
						namedCall(method === "send" || method === "sendIpc" ? "renderer-command" : "renderer-event", node, 0, "electron-ipc");
					} else unknown("renderer-method", access);
				}
				if (/^(?:electron(?:\(\))?|window\.Electron|(?:U\.Common|this)\.getElectron\(\))$/.test(owner)) {
					if (method) record("native-method", method, { ...ref(node), expression: access.getText(ast) }, "native-bridge");
					else unknown("native-method", access);
					if (method === "Api") namedCall("native-command", node, 1, "native-bridge");
				}
			}

			if (source.file === SERVICE && ts.isVariableDeclaration(node) && node.name.getText(ast) === "registry" &&
				node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
				for (const property of node.initializer.properties) {
					if (ts.isPropertyAssignment(property) && !ts.isComputedPropertyName(property.name)) {
						record("registry-command", literal(property.name) ?? property.name.getText(ast), ref(property), "grpc-web/unary");
					}
				}
			}
			if (source.file === COMMAND) {
				if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
					ts.isVariableDeclarationList(node.parent) && exported(node.parent.parent) &&
					node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
					wrapper = node.name.text;
					add("command-wrapper", wrapper, node);
				}
				if (ts.isFunctionDeclaration(node) && exported(node) && node.name) {
					wrapper = node.name.text;
					add("command-wrapper", wrapper, node);
				}
			}
			if (ts.isCallExpression(node) && node.expression.getText(ast) === "dispatcher.request") {
				const name = literal(node.arguments[0]);
				if (name !== undefined) add("dispatcher-command", name, node, wrapper);
				else unknown("dispatcher-command", node.arguments[0] ?? node.expression);
			}
			ts.forEachChild(node, (child) => visit(child, wrapper));
		};
		visit(ast);
	}
	const entries = [...capabilities.values()].sort((a, b) => compare(a.id, b.id));
	const names = (kind: string) => entries.filter((c) => c.kind === kind).map((c) => c.name);
	const dispatched = names("dispatcher-command");
	const registry = names("registry-command");
	const proto = names("proto-rpc");
	const difference = (left: string[], right: string[]) => left.filter((name) => !right.includes(name));
	// Explicit comparison candidates requested for this audit, NOT accepted aliases.
	// Only emit comparisons when both spellings are evidenced by the input sources.
	const comparisons = [
		["DebugExportLog", "LogSend"],
		["ObjectTypeRelationAdd", "ObjectTypePropertyAdd"],
		["ObjectTypeRelationRemove", "ObjectTypePropertyRemove"],
	].filter(([dispatch, declaration]) => dispatched.includes(dispatch) && (registry.includes(declaration) || proto.includes(declaration)));
	return {
		schemaVersion: 1,
		coverage: {
			exhaustive: false,
			mode: "generated-source-inventory; not implementation tracking",
			statusMeaning: "pending = migration not implemented/verified; needs-review = unresolved evidence. Existing mocks/handlers do not establish working functionality.",
			targetMeaning: "All targets are unset. Hono hc, Hocuspocus+Tiptap, BetterAuth and self-hosted Web replacements require separate reviewed mappings/implementation tracking; regeneration does not preserve hand-edited statuses.",
			traversal: "front_web/src/**/*.{ts,tsx,js,jsx,mts,cts,mjs,cjs}, plus the service proto and generated event types listed in sources",
			exclusions: ["test/spec/stories files and __tests__/__mocks__ directories", "declaration files", "dependencies, build/configuration files, assets, and generated middleware except Event types"],
			limitations: [
				"Syntactic observations, not runtime reachability or a call graph; no frontend code is executed.",
				"C, dispatcher, Renderer, electron and getElectron spellings are recognized; arbitrary aliases, shadowing, destructuring and indirect calls are not resolved.",
				"Computed calls/paths encountered at recognized boundaries are explicit in unresolved; this is not an exhaustive list of dynamic behavior.",
				"Registry-only means no literal dispatcher match, not unused or unreachable. A stream absent from the unary registry is not a unary drift error.",
				"Proto RPC scanning validates signatures only, not the full protobuf grammar. Event types/fields and mapper helpers are distinct from handled events.",
				"Page component keys, generic route patterns and navigation use-sites are separate; no per-RPC HTTP/page routes are inferred.",
				"Only direct fetch/WebSocket/EventSource/URL constructions and media helpers are inspected; third-party networking and resolved environment URLs require review.",
			],
		},
		summary: {
			sourceFiles: sources.length,
			capabilitiesByKind: Object.fromEntries([...new Set(entries.map((c) => c.kind))].sort(compare).map((kind) => [kind, entries.filter((c) => c.kind === kind).length])),
			referencesByKind: Object.fromEntries([...new Set(entries.map((c) => c.kind))].sort(compare).map((kind) => [kind, entries.filter((c) => c.kind === kind).reduce((count, c) => count + c.references.length, 0)])),
			unresolved: unresolved.length,
		},
		sources: [...sources].sort((a, b) => compare(a.file, b.file)).map((source) => ({
			file: source.file, sha256: createHash("sha256").update(source.text).digest("hex"),
		})),
		capabilities: entries,
		unresolved,
		drift: {
			dispatchWithoutRegistry: difference(dispatched, registry),
			registryWithoutLiteralDispatch: difference(registry, dispatched),
			registryWithoutProto: difference(registry, proto),
			protoUnaryWithoutRegistry: difference(entries.filter((c) => c.kind === "proto-rpc" && c.protocol === "grpc-web/unary").map((c) => c.name), registry),
			wrapperRequestNameDifferences: entries.filter((c) => c.kind === "dispatcher-command").flatMap((c) =>
				c.references.filter((r) => r.wrapper && r.wrapper !== c.name).map((r) => ({ wrapper: r.wrapper!, request: c.name }))),
			nameComparisons: comparisons.map(([dispatch, declaration]) => ({
				dispatch, declaration, status: "needs-review" as const,
				references: entries.filter((c) => c.name === dispatch || c.name === declaration).flatMap((c) => c.references),
			})),
		},
	};
}

export function serializeClientInventory(inventory: ReturnType<typeof extractClientInventory>): string {
	return `${JSON.stringify(inventory, null, 2)}\n`;
}

/** External I/O seam: tests can supply source files and an in-memory committed artifact. */
export interface InventoryIO {
	loadSources(): Promise<InventorySource[]>;
	readManifest(): Promise<string | undefined>;
	writeManifest(content: string): Promise<void>;
	report(message: string): void;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isRuntimeSource = (file: string) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(file) &&
	!/\.(?:test|spec|stories)\./.test(file) && !/\.d\.[cm]?ts$/.test(file);

/** Read the working tree, not git's index. Missing/unreadable inputs fail closed. */
export function createFileInventoryIO(root = repositoryRoot): InventoryIO {
	const manifest = join(root, "docs/frontend-capabilities.json");
	return {
		async loadSources() {
			const files: string[] = [];
			const walk = async (directory: string) => {
				const entries = await readdir(directory, { withFileTypes: true });
				for (const entry of entries.sort((a, b) => compare(a.name, b.name))) {
					const path = join(directory, entry.name);
					if (["__tests__", "__mocks__", "node_modules"].includes(entry.name)) continue;
					if (entry.isSymbolicLink()) throw new Error(`Refusing symlink during source traversal: ${path}`);
					if (entry.isDirectory()) await walk(path);
					else if (entry.isFile() && isRuntimeSource(entry.name)) files.push(relative(root, path).split("\\").join("/"));
				}
			};
			await walk(join(root, "front_web/src"));
			for (const required of [COMMAND, SERVICE, MAPPER, DISPATCHER, ROUTES, PAGES, COMMON, NATIVE]) {
				if (!files.includes(required)) throw new Error(`Missing required inventory source: ${required}`);
			}
			files.push(PROTO, EVENTS);
			const sources: InventorySource[] = [];
			for (const file of files.sort(compare)) {
				const path = join(root, file);
				if (!(await lstat(path)).isFile()) throw new Error(`Expected regular source file: ${path}`);
				sources.push({ file, text: await readFile(path, "utf8") });
			}
			return sources;
		},
		async readManifest() {
			try { return await readFile(manifest, "utf8"); }
			catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
		},
		async writeManifest(content) { await writeFile(manifest, content, "utf8"); },
		report: (message) => console.log(message),
	};
}

/** Exit codes: 0 = success, 1 = check drift/missing artifact, 2 = extraction/I/O/usage failure. */
export async function runClientInventory(args: readonly string[], io: InventoryIO = createFileInventoryIO()): Promise<number> {
	try {
		if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) throw new Error("Usage: client-inventory.ts [--check]");
		const inventory = extractClientInventory(await io.loadSources());
		const content = serializeClientInventory(inventory);
		if (args[0] === "--check") {
			if (await io.readManifest() !== content) {
				io.report("Client inventory drift (or missing manifest); regenerate docs/frontend-capabilities.json.");
				return 1;
			}
			io.report("Client inventory matches source snapshot.");
		} else {
			await io.writeManifest(content);
			io.report(`Generated docs/frontend-capabilities.json (${inventory.capabilities.length} inventory entries; no migration completion claimed).`);
		}
		return 0;
	} catch (error) {
		io.report(`Client inventory failed: ${error instanceof Error ? error.message : String(error)}`);
		return 2;
	}
}

// Run with root `pnpm exec tsx scripts/client-inventory.ts [--check]`.
// Importing this module (including in Vitest) never performs traversal or writes.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	process.exitCode = await runClientInventory(process.argv.slice(2));
}
