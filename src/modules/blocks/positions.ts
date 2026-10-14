import { ConflictError } from "../../errors/http-errors.js";

const DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BASE = BigInt(DIGITS.length);
const MAX_DEPTH = 24;

function toValue(label: string, scale: bigint): bigint {
	let unit = scale;
	let total = 0n;

	for (const char of label) {
		unit /= BASE;
		total += BigInt(DIGITS.indexOf(char)) * unit;
	}

	return total;
}

function toLabel(value: bigint, scale: bigint): string {
	let unit = scale;
	let rest = value;
	let label = "";

	while (rest > 0n) {
		unit /= BASE;
		const digit = rest / unit;
		rest -= digit * unit;
		label += DIGITS[Number(digit)];
	}

	return label;
}

/**
 * A label that sorts strictly between two siblings, treating the strings as base-36
 * fractions so a list can be split indefinitely without renumbering (ADR-0003). A
 * missing lower bound means the front, a missing upper bound means the end.
 */
export function mintPosition(before: string | null, after: string | null) {
	const known = Math.max(before?.length ?? 0, after?.length ?? 0);

	for (let depth = known + 1; depth <= known + MAX_DEPTH; depth += 1) {
		const scale = BASE ** BigInt(depth);
		const low = before === null ? 0n : toValue(before, scale);
		const high = after === null ? scale : toValue(after, scale);

		if (high - low > 1n) {
			return toLabel((low + high) / 2n, scale);
		}
	}

	throw new ConflictError("There is no room left to position that block.");
}
