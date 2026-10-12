import { Hono } from "hono";
import { ConflictError, ValidationError } from "../../errors/http-errors.js";
import { auth } from "../../lib/auth.js";
import { prisma } from "../../lib/prisma.js";
import { HostRegisterSchema } from "./schema.js";

export const authRouter = new Hono()
	.post("/register/host", async (c) => {
		const result = HostRegisterSchema.safeParse(await c.req.json());

		if (!result.success) {
			throw new ValidationError(result.error.issues[0]?.message);
		}

		const body = result.data;
		const email = body.email.toLowerCase();
		const existingUser = await prisma.user.findUnique({
			where: {
				email,
			},
		});

		if (existingUser) {
			throw new ConflictError("An account with that email already exists.");
		}

		await auth.api.createUser({
			body: {
				name: body.name,
				email,
				password: body.password,
				role: "host",
			},
		});

		const signInUrl = new URL(c.req.raw.url);
		const headers = new Headers(c.req.raw.headers);

		signInUrl.pathname = signInUrl.pathname.replace(
			"/register/host",
			"/auth/sign-in/email",
		);
		headers.set("content-type", "application/json");

		const signInResponse = await auth.handler(
			new Request(signInUrl, {
				method: "POST",
				headers,
				body: JSON.stringify({
					email,
					password: body.password,
					rememberMe: body.rememberMe,
				}),
			}),
		);
		const signInResult = await signInResponse.json();

		return Response.json(signInResult, {
			status: 201,
			headers: signInResponse.headers,
		});
	})
	.on(["POST", "GET"], "/auth/*", (c) => {
		return auth.handler(c.req.raw);
	});
