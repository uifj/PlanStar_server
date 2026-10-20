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
