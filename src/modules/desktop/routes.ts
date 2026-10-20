import { createRoute } from "@hono/zod-openapi";
import z from "zod";
import { requestBody } from "../../openapi/requests.js";
import { createdResponse, notFoundResponse } from "../../openapi/responses.js";
import { OPENAPI_TAGS } from "../../openapi/tags.js";
import {
	FeedbackIntakeSchema,
	IntakeAcceptedSchema,
	ReleaseArtifactParamsSchema,
	ReleaseManifestQuerySchema,
} from "./schema.js";

const tags = [OPENAPI_TAGS.DESKTOP];

export const submitFeedbackRoute = createRoute({
	method: "post",
	path: "/feedback",
	tags,
	summary: "Submit desktop feedback",
	description:
		"Intake for the Electron shell's feedback dialog. The text and context are persisted under " +
		"DESKTOP_DATA_ROOT/feedback for audit; the screenshot stays local to the shell. Public: a user " +
		"can report a problem even when signed out or mid-crash.",
	request: { ...requestBody(FeedbackIntakeSchema) },
	responses: {
		...createdResponse("Feedback accepted.", IntakeAcceptedSchema),
	},
});

export const submitCrashReportRoute = createRoute({
	method: "post",
	path: "/crash-report",
	tags,
	summary: "Submit a crash report",
	description:
		"Minidump sink for Electron's crashReporter. The raw body is stored verbatim under " +
		"DESKTOP_DATA_ROOT/crash so an external symbolicator can still read it; transport metadata is " +
		"taken from headers/query. The body is binary/multipart, so no JSON schema is declared.",
	responses: {
		202: {
			description: "Crash report accepted.",
			content: { "application/json": { schema: IntakeAcceptedSchema } },
		},
	},
});

export const getReleaseManifestRoute = createRoute({
	method: "get",
	path: "/releases/manifest",
	tags,
	summary: "Release manifest",
	description:
		"Flat YAML update manifest consumed by the shell's manifest provider. Answers 404 when no " +
		"release is published (DESKTOP_RELEASE_VERSION/PATH unset), which the shell reads as " +
		"update-not-available rather than an error.",
	request: { query: ReleaseManifestQuerySchema },
	responses: {
		200: {
			description: "Release manifest (YAML).",
			content: { "text/yaml": { schema: z.string() } },
		},
		...notFoundResponse("No release published for this platform/channel."),
	},
});

export const downloadReleaseArtifactRoute = createRoute({
	method: "get",
	path: "/releases/download/{filename}",
	tags,
	summary: "Download a release artifact",
	description:
		"Serves the binary referenced by the manifest's `path`, staged under DESKTOP_DATA_ROOT/releases. " +
		"The filename is resolved inside that root only; any traversal attempt is rejected with 404.",
	request: { params: ReleaseArtifactParamsSchema },
	responses: {
		200: {
			description: "Artifact bytes.",
			content: { "application/octet-stream": { schema: z.any() } },
		},
		...notFoundResponse("Artifact not found."),
	},
});
