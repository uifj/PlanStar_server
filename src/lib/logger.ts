import pino from "pino";
import { env } from "../config/env.js";

const options: pino.LoggerOptions = {
	level: env.LOG_LEVEL,
	base: undefined,
	timestamp: pino.stdTimeFunctions.isoTime,
	redact: [
		"req.headers.authorization",
		"req.headers.cookie",
		"password",
		"token",
	],

	...(env.NODE_ENV === "development" && {
		transport: {
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "SYS:standard",
				ignore: "pid,hostname",
			},
		},
	}),
};

export const logger = pino(options);
