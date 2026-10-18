import z from "zod";

export const CommandNameParamsSchema = z.object({
	name: z.string().min(1),
});

// ClientCommands carry heterogeneous proto-shaped payloads. The shim forwards
// them opaquely to the command handlers, so the body is a free-form object
// rather than a schema declared per command.
export const CommandBodySchema = z.record(z.string(), z.any()).default({});

// The response mirrors anytype-heart's decoded proto envelope: an error field,
// an optional event, and the command's payload, which the shell's Response[type]
// mapper reads field by field.
export const CommandResponseSchema = z
	.record(z.string(), z.any())
	.meta({ id: "CommandResponse" });

export type CommandBody = z.infer<typeof CommandBodySchema>;
