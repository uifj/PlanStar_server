import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
	NODE_ENV: z
		.enum(["development", "test", "production"])
		.default("development"),

	LOG_LEVEL: z
		.enum(["fatal", "error", "warn", "info", "debug", "trace"])
		.default("info"),

	PORT: z.coerce.number().int().positive().default(8000),

	DATABASE_URL: z.url(),

	BETTER_AUTH_SECRET: z.string().min(1),

	APP_URL: z.url(),

	CLIENT_URL: z.url(),

	/**
	 * Optional so the API still boots (and the agent simply fails a turn) when
	 * no model provider is configured for a given environment.
	 */
	GEMINI_API_KEY: z.string().min(1).optional(),

	DEEPSEEK_API_KEY: z.string().min(1).optional(),

	AGENT_MODEL: z.string().min(1).default("googleai/gemini-flash-latest"),

	/**
	 * Root directory of the local file store. Uploaded file bytes are written here,
	 * keyed by the file object's id, and served back at GET /file/{id}. Relative paths
	 * resolve against the process working directory.
	 */
	FILE_STORAGE_ROOT: z.string().min(1).default(".data/files"),

	/**
	 * Staging directory for the browser upload ingress (POST /api/web-upload). The web
	 * file dialog posts base64 here; the bytes are written under this root and the
	 * resulting path is handed back to FileUpload, which moves them into the file store.
	 */
	FILE_UPLOAD_STAGING_ROOT: z.string().min(1).default(".data/uploads"),

	/**
	 * Directory the ObjectListExport command writes archives into so a browser can download
	 * them (GET /api/export/{name}). A browser cannot hand the server a writable directory, so
	 * this is the export target; the names served back are matched against a conservative
	 * pattern and resolved inside this root.
	 */
	EXPORT_ROOT: z.string().min(1).default(".data/exports"),

	/**
	 * The origin the Electron desktop shell serves its own renderer from. It has to be a fixed port:
	 * CORS and Better Auth both compare the request Origin against this exact string, so an ephemeral
	 * port would show up as an unexplained 401 rather than as a configuration problem. The shell loads
	 * over http (not file://) precisely so the session cookie stays same-site with this API.
	 */
	DESKTOP_ORIGIN: z.string().min(1).default("http://localhost:8321"),

	/**
	 * Root directory for desktop-shell intake artifacts: feedback submissions and crash dumps the
	 * Electron shell forwards to `/api/desktop/*`. Mirrors FILE_STORAGE_ROOT's flat, id-keyed layout
	 * so a self-hosted deployment keeps everything under `.data/` with no extra infra. Relative paths
	 * resolve against the process working directory.
	 */
	DESKTOP_DATA_ROOT: z.string().min(1).default(".data/desktop"),

	/**
	 * Release manifest published to the desktop auto-updater (`GET /api/desktop/releases/manifest`).
	 * When VERSION and PATH are both unset the endpoint answers 404 — "no release published" — which
	 * the shell's manifest provider surfaces as update-not-available rather than an error. Setting
	 * them is how an operator cuts a release without a code change.
	 */
	DESKTOP_RELEASE_VERSION: z.string().min(1).optional(),
	DESKTOP_RELEASE_PATH: z.string().min(1).optional(),
	DESKTOP_RELEASE_NOTES: z.string().optional(),
	DESKTOP_RELEASE_SHA512: z.string().min(1).optional(),
	DESKTOP_RELEASE_DATE: z.string().min(1).optional(),
	DESKTOP_RELEASE_FORCED: z
		.enum(["1", "true", "yes", "on", "0", "false", "no", "off"])
		.default("false"),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
	console.error("❌ Invalid environment variables:");
	throw new Error(z.prettifyError(result.error));
}

export const env = result.data;

export const isDevelopment = env.NODE_ENV === "development";
export const isProduction = env.NODE_ENV === "production";
