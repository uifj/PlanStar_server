import z from "zod";
import { APP_STATUS } from "./constants.js";

export const RootResponseSchema = z.object({
	name: z.string(),
	version: z.string(),
	status: z.literal(APP_STATUS.RUNNING),
	docs: z.string(),
});

export const HealthResponseSchema = z.object({
	status: z.literal(APP_STATUS.OK),
});

export const ReadyOkResponseSchema = z.object({
	status: z.literal(APP_STATUS.READY),
});

export const ReadyFailResponseSchema = z.object({
	status: z.literal(APP_STATUS.NOT_READY),
});
