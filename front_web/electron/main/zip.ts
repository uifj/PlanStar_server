import { deflateRawSync } from "node:zlib";

/**
 * A minimal ZIP writer.
 *
 * The shell only needs "collect some files, deflate them, hand back a buffer". Pulling in `yazl`
 * (~30 KB + transitive `buffer-crc32`) for that is overkill when the format is 100 lines of
 * well-documented binary layout. This module implements the subset we use:
 *
 *   - STORED (no compression) or DEFLATE entries
 *   - No ZIP64 (archives stay well under 4 GB / 65k entries)
 *   - No encryption, no data descriptors, no multi-volume
 *   - Deterministic DOS timestamps derived from `Date`
 *
 * Verified against `unzip -t`, macOS Archive Utility, and `yauzl` round-trip in tests.
 * If we ever need streaming (very large archives), swap this for `yazl` behind the same API.
 */

export interface ZipEntryInput {
	/** Path inside the archive. Forward slashes; must not start with `/`. */
	archivePath: string;
	/** Raw bytes. */
	data: Buffer;
	/** Modification time. Defaults to `new Date()`. */
	mtime?: Date;
	/** Force STORED instead of DEFLATE (e.g. already-compressed payloads). */
	store?: boolean;
}

interface LocalEntry {
	archivePath: string;
	crc: number;
	compressedSize: number;
	uncompressedSize: number;
	dosTime: number;
	dosDate: number;
	flags: number;
	method: number;
	localHeaderOffset: number;
	compressedData: Buffer;
}

const LOCAL_FILE_HEADER_SIG = 0x04034b50;
const CENTRAL_DIRECTORY_SIG = 0x02014b50;
const END_OF_CENTRAL_DIR_SIG = 0x06054b50;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** CRC-32 (IEEE 802.3) with the standard reflected polynomial 0xEDB88320. */
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i += 1) {
		let c = i;
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	return table;
})();

export function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (let i = 0; i < buf.length; i += 1) {
		c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

/** DOS time is 5-bit hours, 6-bit minutes, 6-bit minutes/2. DOS date is year-1980 / month / day. */
function toDosDateTime(date: Date): { dosTime: number; dosDate: number } {
	const year = Math.max(1980, date.getFullYear());
	const dosTime =
		(date.getHours() << 11) |
		(date.getMinutes() << 5) |
		Math.floor(date.getSeconds() / 2);
	const dosDate =
		((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
	return { dosTime, dosDate };
}

function normalizeArchivePath(p: string): string {
	const trimmed = p.replace(/^\/+/, "");
	if (!trimmed) {
		throw new Error("Zip entry archivePath must not be empty");
	}
	// Zip stores paths with forward slashes on every platform.
	return trimmed.replace(/\\/g, "/");
}

export function createZipBuffer(entries: readonly ZipEntryInput[]): Buffer {
	const localEntries: LocalEntry[] = [];
	const chunks: Buffer[] = [];
	let offset = 0;

	for (const entry of entries) {
		const archivePath = normalizeArchivePath(entry.archivePath);
		const pathBuf = Buffer.from(archivePath, "utf8");
		const mtime = entry.mtime ?? new Date();
		const { dosTime, dosDate } = toDosDateTime(mtime);
		const crc = crc32(entry.data);

		let method = METHOD_DEFLATE;
		let compressed = entry.data;
		if (entry.store) {
			method = METHOD_STORED;
		} else {
			const deflated = deflateRawSync(entry.data, { level: 6 });
			// Deflate can grow tiny or already-compressed inputs; fall back to STORED when it does.
			if (deflated.length >= entry.data.length) {
				method = METHOD_STORED;
				compressed = entry.data;
			} else {
				compressed = deflated;
			}
		}

		const localHeader = Buffer.alloc(30);
		localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIG, 0);
		localHeader.writeUInt16LE(20, 4); // version needed
		localHeader.writeUInt16LE(0x0800, 6); // flags: UTF-8 filename
		localHeader.writeUInt16LE(method, 8);
		localHeader.writeUInt16LE(dosTime, 10);
		localHeader.writeUInt16LE(dosDate, 12);
		localHeader.writeUInt32LE(crc, 14);
		localHeader.writeUInt32LE(compressed.length, 18);
		localHeader.writeUInt32LE(entry.data.length, 22);
		localHeader.writeUInt16LE(pathBuf.length, 26);
		localHeader.writeUInt16LE(0, 28); // extra field length

		chunks.push(localHeader, pathBuf, compressed);
		localEntries.push({
			archivePath,
			crc,
			compressedSize: compressed.length,
			uncompressedSize: entry.data.length,
			dosTime,
			dosDate,
			flags: 0x0800,
			method,
			localHeaderOffset: offset,
			compressedData: compressed,
		});
		offset += localHeader.length + pathBuf.length + compressed.length;
	}

	const centralStart = offset;
	for (const local of localEntries) {
		const pathBuf = Buffer.from(local.archivePath, "utf8");
		const central = Buffer.alloc(46);
		central.writeUInt32LE(CENTRAL_DIRECTORY_SIG, 0);
		central.writeUInt16LE(20, 4); // version made by
		central.writeUInt16LE(20, 6); // version needed
		central.writeUInt16LE(local.flags, 8);
		central.writeUInt16LE(local.method, 10);
		central.writeUInt16LE(local.dosTime, 12);
		central.writeUInt16LE(local.dosDate, 14);
		central.writeUInt32LE(local.crc, 16);
		central.writeUInt32LE(local.compressedSize, 20);
		central.writeUInt32LE(local.uncompressedSize, 24);
		central.writeUInt16LE(pathBuf.length, 28);
		central.writeUInt16LE(0, 30); // extra length
		central.writeUInt16LE(0, 32); // comment length
		central.writeUInt16LE(0, 34); // disk number
		central.writeUInt16LE(0, 36); // internal attrs
		central.writeUInt32LE(0, 38); // external attrs
		central.writeUInt32LE(local.localHeaderOffset, 42);

		chunks.push(central, pathBuf);
		offset += central.length + pathBuf.length;
	}

	const centralSize = offset - centralStart;
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(END_OF_CENTRAL_DIR_SIG, 0);
	eocd.writeUInt16LE(0, 4); // disk number
	eocd.writeUInt16LE(0, 6); // disk with central dir
	eocd.writeUInt16LE(localEntries.length, 8);
	eocd.writeUInt16LE(localEntries.length, 10);
	eocd.writeUInt32LE(centralSize, 12);
	eocd.writeUInt32LE(centralStart, 16);
	eocd.writeUInt16LE(0, 20); // comment length
	chunks.push(eocd);

	return Buffer.concat(chunks);
}
