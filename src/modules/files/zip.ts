import { crc32 } from "node:zlib";

// A store-only ZIP writer (method 0, no compression). The server has no zip dependency and the
// export feature needs to hand a browser one downloadable file for a selection of any size, so
// the container is built here: local header + bytes, then the central directory, then the end
// record. Entries are stored verbatim, which any unzip/Archive utility can read — the point is
// bundling, not shrinking.
//
// Layout references: the field order and signatures are fixed by APPNOTE.TXT (the ZIP spec).
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const VERSION_MADE_BY = 20;
const VERSION_NEEDED = 20;
// Bit 11: the entry name is UTF-8, which object titles routinely are.
const FLAG_UTF8 = 0x800;
const METHOD_STORE = 0;

export type ZipEntry = { name: string; bytes: Uint8Array };

type DOSDateTime = { time: number; date: number };

// DOS packs a timestamp as second/2 in 5 bits, minute 5, hour 5, and day 5, month 4, year-1980 4.
function dosDateTime(millis: number): DOSDateTime {
	const d = new Date(millis);
	return {
		time:
			d.getHours() * 2048 +
			d.getMinutes() * 32 +
			Math.floor(d.getSeconds() / 2),
		date:
			(d.getFullYear() - 1980) * 512 + (d.getMonth() + 1) * 32 + d.getDate(),
	};
}

function little16(value: number) {
	return [value & 0xff, (value >> 8) & 0xff];
}

function little32(value: number) {
	return [
		value & 0xff,
		(value >> 8) & 0xff,
		(value >> 16) & 0xff,
		(value >>> 24) & 0xff,
	];
}

export function buildZip(entries: ZipEntry[], now = Date.now()): Uint8Array {
	const { time, date } = dosDateTime(now);
	const out: number[] = [];
	const central: number[] = [];
	let offset = 0;

	for (const entry of entries) {
		const name = Array.from(new TextEncoder().encode(entry.name));
		const bytes = Array.from(entry.bytes);
		const checksum = Number(crc32(entry.bytes));

		out.push(
			...little32(LOCAL_HEADER_SIGNATURE),
			...little16(VERSION_NEEDED),
			...little16(FLAG_UTF8),
			...little16(METHOD_STORE),
			...little16(time),
			...little16(date),
			...little32(checksum),
			...little32(bytes.length),
			...little32(bytes.length),
			...little16(name.length),
			...little16(0),
			...name,
			...bytes,
		);

		central.push(
			...little32(CENTRAL_SIGNATURE),
			...little16(VERSION_MADE_BY),
			...little16(VERSION_NEEDED),
			...little16(FLAG_UTF8),
			...little16(METHOD_STORE),
			...little16(time),
			...little16(date),
			...little32(checksum),
			...little32(bytes.length),
			...little32(bytes.length),
			...little16(name.length),
			...little16(0),
			...little16(0),
			...little16(0),
			...little16(0),
			...little32(0),
			...little32(offset),
			...name,
		);

		offset += 30 + name.length + bytes.length;
	}

	const directoryOffset = offset;
	const directorySize = central.length;
	out.push(...central);
	out.push(
		...little32(END_SIGNATURE),
		...little16(0),
		...little16(0),
		...little16(entries.length),
		...little16(entries.length),
		...little32(directorySize),
		...little32(directoryOffset),
		...little16(0),
	);

	return Uint8Array.from(out);
}

// Read the central directory back. The writer above and this reader are deliberately separate
// code paths: a test that parses what buildZip produced catches an offset or field-order mistake
// that a reader-and-writer pair built from the same helper would hide.
function findEndRecord(bytes: Uint8Array) {
	// A comment may follow the record, so scan backwards for the signature. TypedArray's
	// lastIndexOf matches a single element, not a subsequence, hence the manual walk.
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let i = bytes.byteLength - 4; i >= 0; i -= 1) {
		if (view.getUint32(i, true) === END_SIGNATURE) {
			return i;
		}
	}
	return -1;
}

export function readZipIndex(bytes: Uint8Array) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const end = findEndRecord(bytes);
	if (end < 0) {
		throw new Error("Not a zip archive: no end-of-central-directory record");
	}

	const count = view.getUint16(end + 10, true);
	const entries: Array<{
		name: string;
		offset: number;
		size: number;
		crc: number;
	}> = [];
	let cursor = view.getUint32(end + 16, true);

	for (let i = 0; i < count; i += 1) {
		if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
			throw new Error(`Central directory entry ${i} has no signature`);
		}
		const nameLength = view.getUint16(cursor + 28, true);
		entries.push({
			name: new TextDecoder().decode(
				bytes.subarray(cursor + 46, cursor + 46 + nameLength),
			),
			size: view.getUint32(cursor + 20, true),
			crc: view.getUint32(cursor + 16, true),
			offset: view.getUint32(cursor + 42, true),
		});
		cursor +=
			46 +
			nameLength +
			view.getUint16(cursor + 30, true) +
			view.getUint16(cursor + 32, true);
	}

	return entries;
}

// The stored bytes of an entry, read from its local header.
export function readZipEntry(
	bytes: Uint8Array,
	entry: { offset: number; size: number },
) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(entry.offset, true) !== LOCAL_HEADER_SIGNATURE) {
		throw new Error("Local header signature missing");
	}
	const start = entry.offset + 30 + view.getUint16(entry.offset + 26, true);
	return bytes.subarray(start, start + entry.size);
}
