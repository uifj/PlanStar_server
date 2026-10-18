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
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
	console.error("❌ Invalid environment variables:");
	throw new Error(z.prettifyError(result.error));
}

export const env = result.data;

export const isDevelopment = env.NODE_ENV === "development";
export const isProduction = env.NODE_ENV === "production";
