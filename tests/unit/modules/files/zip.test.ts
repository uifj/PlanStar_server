import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	buildZip,
	readZipEntry,
	readZipIndex,
} from "../../../../src/modules/files/zip.js";

// The archive writer is byte-level code, so the tests are: the CRC primitive against its
// published check value, the container read back through an independently written parser, and —
// when the machine has one — a real unzip utility agreeing that the archive is intact.
describe("store-only zip writer", () => {
	const encode = (text: string) =>
		Uint8Array.from(new TextEncoder().encode(text));

	it("uses the CRC-32 check value published for 123456789", () => {
		expect(Number(crc32(encode("123456789")))).toBe(0xcbf43926);
	});

	it("indexes every entry and stores its bytes verbatim", () => {
		const first = encode("# Bergen\n\nWharf at dawn.\n");
		const second = encode("a,b\n1,2\n");
		const zip = buildZip(
			[
				{ name: "Bergen.md", bytes: first },
				{ name: "tall/cross-ålen.csv", bytes: second },
			],
			// Fixed so a failing archive is reproducible; the DOS time fields are not asserted.
			Date.UTC(2026, 4, 4, 13, 45, 30),
		);

		const index = readZipIndex(zip);
		expect(index.map((entry) => entry.name)).toEqual([
			"Bergen.md",
			"tall/cross-ålen.csv",
		]);
		expect(readZipEntry(zip, index[0])).toEqual(first);
		expect(readZipEntry(zip, index[1])).toEqual(second);
		expect(index[0].crc).toBe(Number(crc32(first)));
		expect(index[1].crc).toBe(Number(crc32(second)));
	});

	it("is readable by the system unzip utility", (s) => {
		let tool = "";
		try {
			execFileSync("unzip", ["-v"], { stdio: "ignore" });
			tool = "unzip";
		} catch {
			s.skip();
		}

		const zip = buildZip([
			{
				name: "notes/Bergen.md",
				bytes: encode("# Bergen\n\nWharf at dawn.\n"),
			},
			{ name: "notes/empty.md", bytes: new Uint8Array() },
		]);
		const file = join(mkdtempSync(join(tmpdir(), "zipcheck-")), "export.zip");
		writeFileSync(file, zip);

		const listed = execFileSync(tool, ["-Z", "-1", file], { encoding: "utf8" });
		expect(listed.split("\n").filter(Boolean)).toEqual([
			"notes/Bergen.md",
			"notes/empty.md",
		]);
		expect(execFileSync(tool, ["-t", file], { encoding: "utf8" })).toContain(
			"No errors detected",
		);
	});
});
