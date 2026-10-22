import z from "zod";

/**
 * Feedback forwarded by the shell's feedback dialog. Mirrors front_web's `SubmitFeedbackPayload`
 * minus the base64 screenshot: the image stays local to the shell (persisted under
 * `userData/feedback`), and only the text + context crosses the wire so the intake endpoint never
 * has to accept multi-megabyte bodies.
 */
export const FeedbackIntakeSchema = z.object({
	text: z.string().min(1),
	email: z.string().optional(),
	appVersion: z.string().optional(),
	platform: z.string().optional(),
	locale: z.string().optional(),
	channel: z.string().optional(),
	/** ISO timestamp the shell captured when the user submitted; server stamps its own too. */
	submittedAt: z.string().optional(),
});

export type FeedbackIntake = z.infer<typeof FeedbackIntakeSchema>;

/** Uniform acknowledgement for both intake endpoints: an opaque id the shell can log/reference. */
export const IntakeAcceptedSchema = z.object({
	received: z.literal(true),
	id: z.string().min(1),
});

export type IntakeAccepted = z.infer<typeof IntakeAcceptedSchema>;

/**
 * Manifest selectors. Both are optional: the shell always sends them (query + headers), but a
 * plain browser hit with no params still resolves the single configured release.
 */
export const ReleaseManifestQuerySchema = z.object({
	platform: z.string().optional(),
	channel: z.string().optional(),
});

export type ReleaseManifestQuery = z.infer<typeof ReleaseManifestQuerySchema>;

export const ReleaseArtifactParamsSchema = z.object({
	filename: z.string().min(1),
});

/**
 * Feed path segment. The updater requests both the metadata (`latest-mac.yml`) and the archive that
 * metadata points at from this same route, so the value is no longer constrained to `*.yml` here:
 * `readFeedFile` keeps the builder-name whitelist, and `resolveServableArtifact` only serves files a
 * published yml actually references. The register only bounds the segment so traversal attempts
 * fail closed as 404 instead of reaching the filesystem.
 */
export const ReleaseFeedFileParamsSchema = z.object({
	filename: z.string().min(1).max(255),
});

export type ReleaseFeedFileParams = z.infer<typeof ReleaseFeedFileParamsSchema>;
