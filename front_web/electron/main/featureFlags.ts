/**
 * Feature flags for every optional desktop subsystem.
 *
 * Every subsystem defaults to **on**: a released build without updates, crash reporting, forced
 * updates or log uplink is a build that cannot be operated, and the previous "off until someone
 * flips an env var" default meant the packaged app shipped without those capabilities at all. The
 * env vars remain as a field escape hatch — `HARNESS_DESKTOP_ENABLE_AUTO_UPDATE=0` disables one
 * subsystem without a new build.
 *
 * A flag only exists here when something reads it. `tray` / `notifications` are deliberately absent:
 * the capability contract still advertises both fields, but the shell implements neither, so a flag
 * would toggle nothing — the capabilities handler reports them as `false` unconditionally.
 *
 * Accepted truthy values: `1`, `true`, `yes`, `on` (case-insensitive). Anything else is falsy —
 * including an empty string — so `HARNESS_DESKTOP_ENABLE_LOGGER=` disables the logger. Capabilities
 * that only make sense in a packaged app are gated separately by `app.isPackaged` at the call site.
 */

type FlagName =
	| "logger"
	| "menu"
	| "feedback"
	| "exportLogs"
	| "autoUpdate"
	| "crashReporter"
	| "forceUpdate"
	| "logUpload";

const ENV_KEYS: Record<FlagName, string> = {
	logger: "HARNESS_DESKTOP_ENABLE_LOGGER",
	menu: "HARNESS_DESKTOP_ENABLE_MENU",
	feedback: "HARNESS_DESKTOP_ENABLE_FEEDBACK",
	exportLogs: "HARNESS_DESKTOP_ENABLE_EXPORT_LOGS",
	autoUpdate: "HARNESS_DESKTOP_ENABLE_AUTO_UPDATE",
	crashReporter: "HARNESS_DESKTOP_ENABLE_CRASH_REPORTER",
	forceUpdate: "HARNESS_DESKTOP_ENABLE_FORCE_UPDATE",
	logUpload: "HARNESS_DESKTOP_ENABLE_LOG_UPLOAD",
};

const DEFAULTS: Record<FlagName, boolean> = {
	logger: true,
	menu: true,
	feedback: true,
	exportLogs: true,
	autoUpdate: true,
	crashReporter: true,
	forceUpdate: true,
	logUpload: true,
};

const TRUTHY = new Set(["1", "true", "yes", "on"]);

function readFlag(
	name: FlagName,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	const raw = env[ENV_KEYS[name]];
	if (raw === undefined) {
		return DEFAULTS[name];
	}
	return TRUTHY.has(raw.trim().toLowerCase());
}

export interface DesktopFeatureFlags {
	readonly logger: boolean;
	readonly menu: boolean;
	readonly feedback: boolean;
	readonly exportLogs: boolean;
	readonly autoUpdate: boolean;
	readonly crashReporter: boolean;
	readonly forceUpdate: boolean;
	readonly logUpload: boolean;
}

export function resolveFeatureFlags(
	env: NodeJS.ProcessEnv = process.env,
): DesktopFeatureFlags {
	return Object.freeze({
		logger: readFlag("logger", env),
		menu: readFlag("menu", env),
		feedback: readFlag("feedback", env),
		exportLogs: readFlag("exportLogs", env),
		autoUpdate: readFlag("autoUpdate", env),
		crashReporter: readFlag("crashReporter", env),
		forceUpdate: readFlag("forceUpdate", env),
		logUpload: readFlag("logUpload", env),
	});
}

/** Snapshot resolved once at boot; the shell never re-reads env at runtime. */
export const featureFlags: DesktopFeatureFlags = resolveFeatureFlags();

export const __test__ = { ENV_KEYS, DEFAULTS, readFlag };
