import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { paginated } from "../../response/payload.js";
import {
	addSpaceParticipantRoute,
	createSpaceRoute,
	listSpacesRoute,
	updateSpaceParticipantRoute,
} from "./routes.js";
import { spaceService } from "./service.js";

export const spacesRouter = createProtectedRouter();

spacesRouter.openapi(createSpaceRoute, async (c) => {
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const space = await spaceService.create(user, body);

	return c.json(space, 201);
});

spacesRouter.openapi(listSpacesRoute, async (c) => {
	const query = c.req.valid("query");
	const user = getCurrentUser(c);

	const spaces = await spaceService.findMany(user, query);

	return c.json(paginated(spaces.data, spaces.meta), 200);
});

spacesRouter.openapi(addSpaceParticipantRoute, async (c) => {
	const { spaceId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const participant = await spaceService.addParticipant(user, spaceId, body);

	return c.json(participant, 201);
});

spacesRouter.openapi(updateSpaceParticipantRoute, async (c) => {
	const { spaceId, participantId } = c.req.valid("param");
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const participant = await spaceService.updateParticipant(
		user,
		spaceId,
		participantId,
		body,
	);

	return c.json(participant, 200);
});
