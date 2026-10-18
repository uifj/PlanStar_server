import z from "zod";
import { ListQuerySchema, SortOrderSchema } from "../../pagination/index.js";
import {
	DEFAULT_SPACE_SORT_FIELD,
	DEFAULT_SPACE_SORT_ORDER,
	GRANTABLE_SPACE_PERMISSIONS,
	SPACE_PERMISSIONS,
	SPACE_SORT_FIELDS,
	SPACE_STATUSES,
} from "./constants.js";

export const SpacePermissionSchema = z.enum(SPACE_PERMISSIONS);

export const SpaceSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		status: z.enum(SPACE_STATUSES),
		permission: SpacePermissionSchema,
		createdAt: z.iso.datetime(),
		updatedAt: z.iso.datetime(),
	})
	.meta({ id: "Space" });

export const SpaceParticipantSchema = z
	.object({
		id: z.string(),
		spaceId: z.string(),
		userId: z.string(),
		permission: SpacePermissionSchema,
		status: z.enum(["active", "removed", "joining"]),
		createdAt: z.iso.datetime(),
	})
	.meta({ id: "SpaceParticipant" });

export const CreateSpaceSchema = z
	.object({
		name: z.string().trim().min(1, "Space name is required.").max(120),
	})
	.meta({ id: "CreateSpaceInput" });

export const AddSpaceParticipantSchema = z
	.object({
		userId: z.string().min(1),
		permission: z.enum(GRANTABLE_SPACE_PERMISSIONS),
	})
	.meta({ id: "AddSpaceParticipantInput" });

export const UpdateSpaceParticipantSchema = z
	.object({
		permission: z.enum(GRANTABLE_SPACE_PERMISSIONS),
	})
	.meta({ id: "UpdateSpaceParticipantInput" });

export const SpaceParamsSchema = z.object({
	spaceId: z.string(),
});

export const SpaceParticipantParamsSchema = z.object({
	spaceId: z.string(),
	participantId: z.string(),
});

export const SpaceListQuerySchema = ListQuerySchema.extend({
	sort: z.enum(SPACE_SORT_FIELDS).default(DEFAULT_SPACE_SORT_FIELD),
	order: SortOrderSchema.default(DEFAULT_SPACE_SORT_ORDER),
}).meta({ id: "SpaceListQuery" });

export type CreateSpaceInput = z.infer<typeof CreateSpaceSchema>;
export type AddSpaceParticipantInput = z.infer<
	typeof AddSpaceParticipantSchema
>;
export type UpdateSpaceParticipantInput = z.infer<
	typeof UpdateSpaceParticipantSchema
>;
export type SpaceListQuery = z.infer<typeof SpaceListQuerySchema>;
