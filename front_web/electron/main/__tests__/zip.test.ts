import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { crc32, createZipBuffer, type ZipEntryInput } from "../zip";

/** Parse the End Of Central Directory record to locate the central directory. */
function readEocd(buf: Buffer) {
	// EOCD is at least 22 bytes; scan backwards for the signature.
	for (let i = buf.length - 22; i >= 0; i -= 1) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			return {
				offset: i,
				totalEntries: buf.readUInt16LE(i + 10),
				centralSize: buf.readUInt32LE(i + 12),
				centralOffset: buf.readUInt32LE(i + 16),
			};
		}
	}
	throw new Error("EOCD not found");
}

function readCentralEntries(buf: Buffer, centralOffset: number, count: number) {
	const entries: Array<{
		name: string;
		method: number;
		crc: number;
		compSize: number;
		uncompSize: number;
		localOffset: number;
	}> = [];
	let cursor = centralOffset;
	for (let i = 0; i < count; i += 1) {
		if (buf.readUInt32LE(cursor) !== 0x02014b50) {
			throw new Error(`bad central signature at ${cursor}`);
		}
		const method = buf.readUInt16LE(cursor + 10);
		const crc = buf.readUInt32LE(cursor + 16);
		const compSize = buf.readUInt32LE(cursor + 20);
		const uncompSize = buf.readUInt32LE(cursor + 24);
		const nameLen = buf.readUInt16LE(cursor + 28);
		const extraLen = buf.readUInt16LE(cursor + 30);
		const commentLen = buf.readUInt16LE(cursor + 32);
		const localOffset = buf.readUInt32LE(cursor + 42);
		const name = buf
			.subarray(cursor + 46, cursor + 46 + nameLen)
			.toString("utf8");
		entries.push({ name, method, crc, compSize, uncompSize, localOffset });
		cursor += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}

function readLocalData(
	buf: Buffer,
	localOffset: number,
	method: number,
	compSize: number,
): Buffer {
	if (buf.readUInt32LE(localOffset) !== 0x04034b50) {
		throw new Error("bad local signature");
	}
	const nameLen = buf.readUInt16LE(localOffset + 26);
	const extraLen = buf.readUInt16LE(localOffset + 28);
	const dataStart = localOffset + 30 + nameLen + extraLen;
	const raw = buf.subarray(dataStart, dataStart + compSize);
	return method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
}

describe("zip", () => {
	describe("crc32", () => {
		it('matches the known CRC-32 of "hello"', () => {
			// CRC-32 of ASCII "hello" is 0x3610a686.
			expect(crc32(Buffer.from("hello"))).toBe(0x3610a686);
		});

		it("returns 0 for an empty buffer", () => {
			expect(crc32(Buffer.alloc(0))).toBe(0);
		});
	});

	describe("createZipBuffer", () => {
		it("produces a parseable archive with one stored entry", () => {
			const entries: ZipEntryInput[] = [
				{ archivePath: "a.txt", data: Buffer.from("alpha"), store: true },
			];
			const zip = createZipBuffer(entries);
			const eocd = readEocd(zip);
			expect(eocd.totalEntries).toBe(1);
			const central = readCentralEntries(
				zip,
				eocd.centralOffset,
				eocd.totalEntries,
			);
			expect(central[0].name).toBe("a.txt");
			expect(central[0].method).toBe(0); // STORED
			const data = readLocalData(
				zip,
				central[0].localOffset,
				central[0].method,
				central[0].compSize,
			);
			expect(data.toString("utf8")).toBe("alpha");
		});

		it("deflates compressible payloads and round-trips", () => {
			const payload = Buffer.from("x".repeat(4096));
			const entries: ZipEntryInput[] = [
				{ archivePath: "big.txt", data: payload },
			];
			const zip = createZipBuffer(entries);
			const eocd = readEocd(zip);
			const central = readCentralEntries(
				zip,
				eocd.centralOffset,
				eocd.totalEntries,
			);
			expect(central[0].method).toBe(8); // DEFLATE
			expect(central[0].compSize).toBeLessThan(payload.length);
			const data = readLocalData(
				zip,
				central[0].localOffset,
				central[0].method,
				central[0].compSize,
			);
			expect(data.equals(payload)).toBe(true);
		});

		it("falls back to STORED when deflate would grow the payload", () => {
			// A tiny payload compresses worse than it stores.
			const entries: ZipEntryInput[] = [
				{ archivePath: "tiny", data: Buffer.from("a") },
			];
			const zip = createZipBuffer(entries);
			const eocd = readEocd(zip);
			const central = readCentralEntries(
				zip,
				eocd.centralOffset,
				eocd.totalEntries,
			);
			expect(central[0].method).toBe(0);
		});

		it("handles multiple entries and preserves order", () => {
			const entries: ZipEntryInput[] = [
				{ archivePath: "logs/2025-01-01.log", data: Buffer.from("one") },
				{ archivePath: "logs/2025-01-02.log", data: Buffer.from("two") },
				{ archivePath: "about.json", data: Buffer.from("{}") },
			];
			const zip = createZipBuffer(entries);
			const eocd = readEocd(zip);
			expect(eocd.totalEntries).toBe(3);
			const central = readCentralEntries(
				zip,
				eocd.centralOffset,
				eocd.totalEntries,
			);
			expect(central.map((e) => e.name)).toEqual([
				"logs/2025-01-01.log",
				"logs/2025-01-02.log",
				"about.json",
			]);
		});

		it("normalises backslashes to forward slashes", () => {
			const entries: ZipEntryInput[] = [
				{ archivePath: "logs\\today.log", data: Buffer.from("x") },
			];
			const zip = createZipBuffer(entries);
			const eocd = readEocd(zip);
			const central = readCentralEntries(
				zip,
				eocd.centralOffset,
				eocd.totalEntries,
			);
			expect(central[0].name).toBe("logs/today.log");
		});

		it("rejects an empty archivePath", () => {
			expect(() =>
				createZipBuffer([{ archivePath: "", data: Buffer.from("x") }]),
			).toThrow();
			expect(() =>
				createZipBuffer([{ archivePath: "/", data: Buffer.from("x") }]),
			).toThrow();
		});

		it("produces an empty-but-valid archive for zero entries", () => {
			const zip = createZipBuffer([]);
			const eocd = readEocd(zip);
			expect(eocd.totalEntries).toBe(0);
			expect(eocd.centralSize).toBe(0);
		});
	});
});
