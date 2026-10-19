import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createFileInventoryIO,
	extractClientInventory,
	type InventorySource,
} from "./client-inventory.js";

type ClientInventory = ReturnType<typeof extractClientInventory>;

export interface CoverageSource {
	file: string;
	text: string;
}

/**
 * Server-side dispatch arms that name a command: `case "X"` and `name === "X"`.
 * Only PascalCase arms are collected — the same switch bodies also branch on layout and field
 * names (`case "checkbox"`), which are not commands and would otherwise read as dead answers.
 */
function dispatchArms(text: string) {
	const names = new Set<string>();
	for (const match of text.matchAll(/\bcase\s+"([A-Z][A-Za-z0-9]*)"/g))
		names.add(match[1]);
	for (const match of text.matchAll(/\bname\s*===\s*"([A-Z][A-Za-z0-9]*)"/g))
		names.add(match[1]);
	return names;
}

const intersect = (left: ReadonlySet<string>, right: Iterable<string>) =>
	[...right].filter((name) => left.has(name)).sort();

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Joins the reviewed client surface with the server's dispatch table. Both sides arrive as
 * parsed sources, so nothing here imports or runs application code.
 */
export function collectCommandCoverage(
	client: ClientInventory,
	server: readonly CoverageSource[],
) {
	const declared = new Set(
		client.capabilities
			.filter((c) => c.kind === "dispatcher-command")
			.map((c) => c.name),
	);
	const used = new Set(
		client.capabilities
			.filter((c) => c.kind === "command-use")
			.map((c) => c.name),
	);
	const arms = new Set(
		server.flatMap((source) => [...dispatchArms(source.text)]),
	);

	const answeredNames = intersect(declared, arms);
	const answered = new Set(answeredNames);
	const calledNames = intersect(declared, used);
	const called = new Set(calledNames);

	return {
		schemaVersion: 1,
		declared: declared.size,
		called: calledNames.length,
		answered: answeredNames.length,
		answeredNames,
		calledButUnanswered: calledNames.filter((name) => !answered.has(name)),
		// No literal `C.<name>()` anywhere. Only a hint: computed dispatch is invisible to that scan.
		answeredButUncalled: answeredNames.filter((name) => !called.has(name)),
		// Dispatch arms that are not client commands — other switches, or answers nobody can ask for.
		answeredWithoutCommand: [...arms]
			.filter((name) => !declared.has(name))
			.sort(compare),
		computedDispatch: client.unresolved.filter(
			(entry) => entry.kind === "command-use",
		).length,
		limitations: [
			"Declared and called names come from the client inventory's syntactic pass; aliases, destructuring and indirect calls are not resolved.",
			"Answered names are literal dispatch arms, not proof that the handler does what the client expects.",
			"Both lists of unreached names are review hints: computed dispatch is counted, never attributed.",
		],
	};
}

export interface CoverageIO {
	readClientSources(): Promise<InventorySource[]>;
	readServerSources(): Promise<CoverageSource[]>;
	report(message: string): void;
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function createFileCoverageIO(root = repositoryRoot): CoverageIO {
	const client = createFileInventoryIO(root);
	return {
		readClientSources: () => client.loadSources(),
		async readServerSources() {
			const directory = join(root, "src/modules/command");
			const files = (await readdir(directory, { withFileTypes: true }))
				.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
				.map((entry) => entry.name)
				.sort(compare);
			if (!files.length)
				throw new Error(`No command dispatch sources under ${directory}`);
			return Promise.all(
				files.map(async (name) => {
					const path = join(directory, name);
					return {
						file: relative(root, path).split("\\").join("/"),
						text: await readFile(path, "utf8"),
					};
				}),
			);
		},
		report: (message) => console.log(message),
	};
}

/** Exit codes: 0 = success, 2 = extraction/I/O/usage failure. */
export async function runCommandCoverage(
	args: readonly string[],
	io: CoverageIO = createFileCoverageIO(),
): Promise<number> {
	if (args.length > 1 || (args.length === 1 && args[0] !== "--json")) {
		io.report("Command coverage failed: Usage: command-coverage.ts [--json]");
		return 2;
	}
	const json = args[0] === "--json";
	try {
		const coverage = collectCommandCoverage(
			extractClientInventory(await io.readClientSources()),
			await io.readServerSources(),
		);
		if (json) {
			io.report(JSON.stringify(coverage, null, 2));
			return 0;
		}
		io.report(
			`Command coverage — ${coverage.declared} declared by the client, ${coverage.called} called, ${coverage.answered} answered by the shim.`,
		);
		io.report(
			`${coverage.calledButUnanswered.length} of ${coverage.called} called commands are unanswered.`,
		);
		io.report(
			`${coverage.answeredButUncalled.length} answered commands have no literal call site; ` +
				`${coverage.answeredWithoutCommand.length} dispatch arms are not client commands; ` +
				`${coverage.computedDispatch} computed dispatch expressions are outside these counts.`,
		);
		return 0;
	} catch (error) {
		io.report(
			`Command coverage failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 2;
	}
}

// Run with root `pnpm coverage` (or `pnpm coverage --json`).
if (
	process.argv[1] &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
	process.exitCode = await runCommandCoverage(process.argv.slice(2));
}
