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
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
	console.error("❌ Invalid environment variables:");
	throw new Error(z.prettifyError(result.error));
}

export const env = result.data;

export const isDevelopment = env.NODE_ENV === "development";
export const isProduction = env.NODE_ENV === "production";
