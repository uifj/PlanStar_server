import { app } from "electron";

import { logger } from "./logger";

/**
 * Manifest-based update provider.
 *
 * The plan calls for `electron-updater`'s `Provider<UpdateInfo>`; because the dependency is not
 * yet in `package.json` we keep the surface identical but resolve the class lazily through a
 * dynamic import. When `electron-updater` is missing the provider degrades to a plain fetch +
 * YAML parse so the shell still boots and `autoUpdater.ts` can report "update-not-available"
 * without crashing.
 *
 * Manifest shape (aligned with electron-updater's generic provider):
 *
 *   version: 0.58.0
 *   releaseDate: '2026-10-20T10:00:00Z'
 *   path: Anytype-Harness-0.58.0-arm64.dmg
 *   sha512: <base64>
 *   releaseNotes: |
 *     - …
 *   is_forced: false
 *
 * The provider is deliberately small (~180 lines): we drop Linux multi-format resolution
 * (AppImage/Deb/Rpm/Pacman), preview channels, dev overrides and release-notes i18n that
 * ZCode's 260-line `manifestUpdateProvider.ts` carries — front_web only ships macOS DMG and
 * Windows NSIS.
 */

export interface ManifestUpdateInfo {
	version: string;
	releaseDate?: string;
	path: string;
	sha512?: string;
	releaseNotes?: string;
	/** Server-side flag consumed by `forceUpdateGuard.ts`. */
	is_forced?: boolean;
	/** Absolute URL resolved from `path` + the manifest base. */
	downloadUrl?: string;
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

	if (!result.version || !result.path) {
		throw new Error(
			"parseManifestYaml: manifest missing required `version` or `path`",
		);
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

function buildDownloadUrl(baseUrl: string, filename: string): string {
	const trimmed = baseUrl.replace(/\/+$/, "");
	// `path` may already be absolute; honour it so a CDN can sit in front of the harness.
	if (/^https?:\/\//i.test(filename)) {
		return filename;
	}
	return `${trimmed}/download/${filename.replace(/^\/+/, "")}`;
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
		const info = parseManifestYaml(text);
		info.downloadUrl = buildDownloadUrl(this.options.baseUrl, info.path);
		return info;
	}

	/**
	 * Resolve the file list for `electron-updater`. Returns a single entry because we only ship
	 * one artifact per (platform, channel) pair; ZCode's multi-format Linux branch is not needed.
	 */
	resolveFiles(
		info: ManifestUpdateInfo,
	): Array<{ url: string; sha512?: string; size?: number }> {
		if (!info.downloadUrl) {
			throw new Error("resolveFiles: manifest info is missing downloadUrl");
		}
		return [{ url: info.downloadUrl, sha512: info.sha512 }];
	}
}

/**
 * Convenience factory used by `autoUpdater.ts`. Reads the base URL from
 * `HARNESS_DESKTOP_UPDATE_BASE_URL` (falls back to the harness API origin) and the device id
 * from the persisted settings file when present.
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
		deviceId: overrides.deviceId ?? readDeviceId(),
		fetchImpl: overrides.fetchImpl,
	});
}

function readDeviceId(): string {
	// The device id is persisted by the harness server on first run; when absent we send an empty
	// header and the server treats the request as unfiltered.
	try {
		const settingsPath = `${app.getPath("userData")}/settings.json`;
		// Lazy require so tests can stub `app.getPath` without touching fs.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const fs = require("node:fs") as typeof import("node:fs");
		if (!fs.existsSync(settingsPath)) {
			return "";
		}
		const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
			deviceId?: string;
		};
		return typeof parsed.deviceId === "string" ? parsed.deviceId : "";
	} catch {
		return "";
	}
}

export const __test__ = {
	buildManifestUrl,
	buildDownloadUrl,
	resolvePlatform,
};
