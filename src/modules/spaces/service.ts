import { ensureSpaceAccess } from "../../auth/space-access.js";
import {
	ConflictError,
	ForbiddenError,
	NotFoundError,
} from "../../errors/http-errors.js";
import type { AuthUser } from "../../lib/auth.js";
import {
	createPaginationMeta,
	getPagination,
	getSorting,
} from "../../pagination/index.js";
import {
	DEFAULT_SPACE_SORT_FIELD,
	DEFAULT_SPACE_SORT_ORDER,
} from "./constants.js";
import { toSpace, toSpaceParticipant } from "./dto.js";
import { spaceRepository } from "./repository.js";
import type {
	AddSpaceParticipantInput,
	CreateSpaceInput,
	SpaceListQuery,
	UpdateSpaceParticipantInput,
} from "./schema.js";

async function create(user: AuthUser, input: CreateSpaceInput) {
	const space = await spaceRepository.create(input.name, user.id);

	return toSpace(space);
}

async function findMany(user: AuthUser, query: SpaceListQuery) {
	const { skip, take } = getPagination(query);
	const { orderBy } = getSorting(query.sort, query.order, {
		defaultField: DEFAULT_SPACE_SORT_FIELD,
		defaultOrder: DEFAULT_SPACE_SORT_ORDER,
	});

	const [spaces, total] = await Promise.all([
		spaceRepository.findManyForUser(user.id, { skip, take, orderBy }),
		spaceRepository.countForUser(user.id),
	]);

	return {
		data: spaces.map(toSpace),
		meta: createPaginationMeta({
			page: query.page,
			limit: query.limit,
			total,
		}),
	};
}

async function addParticipant(
	user: AuthUser,
	spaceId: string,
	input: AddSpaceParticipantInput,
) {
	await ensureSpaceAccess(user.id, spaceId, "admin");

	const target = await spaceRepository.findUserById(input.userId);

	if (!target) {
		throw new NotFoundError("User not found.");
	}

	const existing = await spaceRepository.findMember(spaceId, input.userId);

	if (existing) {
		throw new ConflictError("That user already has access to this space.");
	}

	const member = await spaceRepository.createMember({
		spaceId,
		userId: input.userId,
		permission: input.permission,
	});

	return toSpaceParticipant(member);
}

async function updateParticipant(
	user: AuthUser,
	spaceId: string,
	participantId: string,
	input: UpdateSpaceParticipantInput,
) {
	await ensureSpaceAccess(user.id, spaceId, "admin");

	const participant = await spaceRepository.findParticipantById(
		spaceId,
		participantId,
	);

	if (!participant) {
		throw new NotFoundError("Participant not found.");
	}

	if (participant.permission === "owner") {
		throw new ForbiddenError("The space owner cannot be changed here.");
	}

	const updated = await spaceRepository.updateMemberPermission(
		participant.id,
		input.permission,
	);

	return toSpaceParticipant(updated);
}

export const spaceService = {
	create,
	findMany,
	addParticipant,
	updateParticipant,
};
