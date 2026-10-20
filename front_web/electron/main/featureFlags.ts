/**
 * Feature flags for every optional desktop subsystem.
 *
 * The refactor lands in six stages; each stage's subsystem is guarded by an env var so a single
 * misbehaving module can be turned off in the field without a new build. Defaults match the plan:
 * the low-risk items (logger, menu, deep-link hardening, feedback, export-logs) are on, and the
 * high-risk items (auto-update, crash reporter, force update) are off until they are explicitly
 * enabled per deployment.
 *
 * Accepted truthy values: `1`, `true`, `yes`, `on` (case-insensitive). Anything else is falsy —
 * including an empty string — so `HARNESS_DESKTOP_ENABLE_LOGGER=` disables the logger.
 */

type FlagName =
	| "logger"
	| "menu"
	| "deepLinkHardening"
	| "feedback"
	| "exportLogs"
	| "tray"
	| "notifications"
	| "autoUpdate"
	| "crashReporter"
	| "forceUpdate";

const ENV_KEYS: Record<FlagName, string> = {
	logger: "HARNESS_DESKTOP_ENABLE_LOGGER",
	menu: "HARNESS_DESKTOP_ENABLE_MENU",
	deepLinkHardening: "HARNESS_DESKTOP_ENABLE_DEEPLINK_HARDENING",
	feedback: "HARNESS_DESKTOP_ENABLE_FEEDBACK",
	exportLogs: "HARNESS_DESKTOP_ENABLE_EXPORT_LOGS",
	tray: "HARNESS_DESKTOP_ENABLE_TRAY",
	notifications: "HARNESS_DESKTOP_ENABLE_NOTIFICATIONS",
	autoUpdate: "HARNESS_DESKTOP_ENABLE_AUTO_UPDATE",
	crashReporter: "HARNESS_DESKTOP_ENABLE_CRASH_REPORTER",
	forceUpdate: "HARNESS_DESKTOP_ENABLE_FORCE_UPDATE",
};

const DEFAULTS: Record<FlagName, boolean> = {
	logger: true,
	menu: true,
	deepLinkHardening: true,
	feedback: true,
	exportLogs: true,
	tray: false,
	notifications: true,
	autoUpdate: false,
	crashReporter: false,
	forceUpdate: false,
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
	readonly deepLinkHardening: boolean;
	readonly feedback: boolean;
	readonly exportLogs: boolean;
	readonly tray: boolean;
	readonly notifications: boolean;
	readonly autoUpdate: boolean;
	readonly crashReporter: boolean;
	readonly forceUpdate: boolean;
}

export function resolveFeatureFlags(
	env: NodeJS.ProcessEnv = process.env,
): DesktopFeatureFlags {
	return Object.freeze({
		logger: readFlag("logger", env),
		menu: readFlag("menu", env),
		deepLinkHardening: readFlag("deepLinkHardening", env),
		feedback: readFlag("feedback", env),
		exportLogs: readFlag("exportLogs", env),
		tray: readFlag("tray", env),
		notifications: readFlag("notifications", env),
		autoUpdate: readFlag("autoUpdate", env),
		crashReporter: readFlag("crashReporter", env),
		forceUpdate: readFlag("forceUpdate", env),
	});
}

/** Snapshot resolved once at boot; the shell never re-reads env at runtime. */
export const featureFlags: DesktopFeatureFlags = resolveFeatureFlags();

export const __test__ = { ENV_KEYS, DEFAULTS, readFlag };
