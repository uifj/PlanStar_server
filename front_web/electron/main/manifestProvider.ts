import { logger } from "./logger";

/**
 * Policy-manifest reader.
 *
 * The update itself is `electron-updater`'s job: it reads the `latest-mac.yml` that
 * electron-builder emits and verifies the artifact's sha512. What builder metadata cannot express
 * — `is_forced` for the force-update guard, and the human release notes — lives on the harness's
 * own `/releases/manifest` channel, and this module is the only reader of it.
 *
 * Manifest shape (aligned with electron-updater's generic provider):
 *
 *   version: 0.58.0
 *   releaseDate: '2026-10-20T10:00:00Z'
 *   path: Planstar-0.58.0-arm64.dmg
 *   sha512: <base64>
 *   releaseNotes: |
 *     - …
 *   is_forced: false
 *
 * `path` / `sha512` are still part of the wire shape (the server writes them and they document
 * which artifact a policy entry refers to), but they are not used to build a download URL: the
 * artifact URL comes from the builder feed. The hand-rolled resolution helpers this module used
 * to carry were removed along with the hand-rolled updater they served.
 */

export interface ManifestUpdateInfo {
	version: string;
	releaseDate?: string;
	/** Optional: only present when the operator staged an artifact name alongside the policy. */
	path?: string;
	sha512?: string;
	releaseNotes?: string;
	/** Server-side flag consumed by `forceUpdateGuard.ts`. */
	is_forced?: boolean;
}

export interface ManifestProviderOptions {
	/** Base URL of the manifest endpoint, e.g. `http://localhost:8000/api/desktop/releases`. */
	baseUrl: string;
	/** Release channel (`stable`, `beta`, …). Sent as `X-Release-Channel`. */
	channel?: string;
	/** Platform identifier sent as `X-Platform`; defaults to `${process.platform}-${process.arch}`. */
	platform?: string;
	/** Device id sent as `X-Device-Mid` for grey-release filtering. */
	deviceId?: string;
	/** Override for tests. */
	fetchImpl?: typeof fetch;
}

const DEFAULT_CHANNEL = "stable";

function resolvePlatform(explicit?: string): string {
	if (explicit) {
		return explicit;
	}
	return `${process.platform}-${process.arch}`;
}

/**
 * Minimal YAML reader for the flat manifest shape above. We do not pull in `yaml` / `js-yaml`:
 * the manifest is a handful of scalar keys plus an optional block scalar for release notes, and
 * a 40-line parser covers it. Anything more complex (nested maps, anchors) is rejected with a
 * clear error rather than silently mis-parsed.
 */
export function parseManifestYaml(text: string): ManifestUpdateInfo {
	const lines = text.split(/\r?\n/);
	const result: Record<string, string> = {};
	let currentKey: string | null = null;
	let blockLines: string[] = [];

	const flushBlock = (): void => {
		if (currentKey && blockLines.length > 0) {
			result[currentKey] = blockLines.join("\n").replace(/\n+$/, "");
		}
		currentKey = null;
		blockLines = [];
	};

	for (const raw of lines) {
		if (!raw.trim() || raw.trim().startsWith("#")) {
			if (currentKey) {
				blockLines.push("");
			}
			continue;
		}
		const blockMatch = raw.match(/^([A-Za-z_][\w-]*):\s*[|>]-?\s*$/);
		if (blockMatch) {
			flushBlock();
			currentKey = blockMatch[1];
			continue;
		}
		const kvMatch = raw.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
		if (kvMatch && raw.match(/^\S/)) {
			flushBlock();
			let value = kvMatch[2].trim();
			// Strip surrounding quotes (single or double).
			if (
				(value.startsWith("'") && value.endsWith("'")) ||
				(value.startsWith('"') && value.endsWith('"'))
			) {
				value = value.slice(1, -1);
			}
			result[kvMatch[1]] = value;
			continue;
		}
		// Indented line while inside a block scalar.
		if (currentKey && /^\s/.test(raw)) {
			blockLines.push(raw.replace(/^\s{2}/, ""));
			continue;
		}
		throw new Error(
			`parseManifestYaml: unsupported line ${JSON.stringify(raw)}`,
		);
	}
	flushBlock();

	// `version` is the only key the shell actually needs: the artifact URL comes from the builder
	// feed, so a policy entry without `path`/`sha512` is still actionable ("0.58.0 is out / is
	// mandatory"). Requiring `path` made a metadata-only rollout impossible.
	if (!result.version) {
		throw new Error("parseManifestYaml: manifest missing required `version`");
	}

	return {
		version: result.version,
		releaseDate: result.releaseDate,
		path: result.path,
		sha512: result.sha512,
		releaseNotes: result.releaseNotes,
		is_forced: result.is_forced === "true" || result.is_forced === "yes",
	};
}

function buildManifestUrl(
	baseUrl: string,
	platform: string,
	channel: string,
): string {
	const trimmed = baseUrl.replace(/\/+$/, "");
	const params = new URLSearchParams({ platform, channel });
	return `${trimmed}/manifest?${params.toString()}`;
}

export class ManifestUpdateProvider {
	private readonly options: Required<
		Omit<ManifestProviderOptions, "fetchImpl">
	> & {
		fetchImpl: typeof fetch;
	};

	constructor(options: ManifestProviderOptions) {
		this.options = {
			baseUrl: options.baseUrl,
			channel: options.channel ?? DEFAULT_CHANNEL,
			platform: resolvePlatform(options.platform),
			deviceId: options.deviceId ?? "",
			fetchImpl: options.fetchImpl ?? fetch,
		};
	}

	async getLatestVersion(): Promise<ManifestUpdateInfo> {
		const url = buildManifestUrl(
			this.options.baseUrl,
			this.options.platform,
			this.options.channel,
		);
		logger.info("[manifest-provider] GET", url);

		const headers: Record<string, string> = {
			Accept: "application/yaml, text/yaml, text/plain;q=0.9, */*;q=0.1",
			"X-Platform": this.options.platform,
			"X-Release-Channel": this.options.channel,
		};
		if (this.options.deviceId) {
			headers["X-Device-Mid"] = this.options.deviceId;
		}

		const response = await this.options.fetchImpl(url, {
			headers,
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok) {
			throw new Error(
				`manifest fetch failed: ${response.status} ${response.statusText}`,
			);
		}
		const text = await response.text();
		return parseManifestYaml(text);
	}
}

/**
 * Convenience factory used by `autoUpdater.ts`. Reads the base URL from
 * `HARNESS_DESKTOP_UPDATE_BASE_URL` (falls back to the harness API origin).
 */
export function createManifestProvider(
	overrides: Partial<ManifestProviderOptions> = {},
): ManifestUpdateProvider {
	const baseUrl =
		overrides.baseUrl ??
		process.env.HARNESS_DESKTOP_UPDATE_BASE_URL ??
		`${(process.env.HARNESS_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")}/api/desktop/releases`;

	return new ManifestUpdateProvider({
		baseUrl,
		channel:
			overrides.channel ??
			process.env.HARNESS_DESKTOP_UPDATE_CHANNEL ??
			DEFAULT_CHANNEL,
		platform: overrides.platform,
		deviceId: overrides.deviceId,
		fetchImpl: overrides.fetchImpl,
	});
}

export const __test__ = {
	buildManifestUrl,
	parseManifestYaml,
	resolvePlatform,
};
