import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { paginated } from "../../response/payload.js";
import {
	createHostVanRoute,
	deleteHostVanRoute,
	getHostDashboardRoute,
	getHostIncomeRoute,
	getHostReviewsRoute,
	getHostVanRoute,
	listHostBookingsRoute,
	listHostVansRoute,
	updateHostBookingStatusRoute,
	updateHostVanRoute,
} from "./routes.js";
import { hostService } from "./service.js";

export const hostRouter = createProtectedRouter();

hostRouter.openapi(listHostVansRoute, async (c) => {
	const user = getCurrentUser(c);
	const query = c.req.valid("query");

	const vans = await hostService.findVans(user, query);

	return c.json({ data: vans }, 200);
});

hostRouter.openapi(getHostVanRoute, async (c) => {
	const user = getCurrentUser(c);
	const { id } = c.req.valid("param");

	const van = await hostService.findVanById(user, id);

	return c.json(van, 200);
});

hostRouter.openapi(createHostVanRoute, async (c) => {
	const user = getCurrentUser(c);
	const body = c.req.valid("json");

	const van = await hostService.createVan(user, body);

	return c.json(van, 201);
});

hostRouter.openapi(updateHostVanRoute, async (c) => {
	const user = getCurrentUser(c);
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");

	const van = await hostService.updateVan(user, id, body);

	return c.json(van, 200);
});

hostRouter.openapi(deleteHostVanRoute, async (c) => {
	const user = getCurrentUser(c);
	const { id } = c.req.valid("param");

	await hostService.deleteVan(user, id);

	return c.body(null, 204);
});

hostRouter.openapi(getHostDashboardRoute, async (c) => {
	const user = getCurrentUser(c);
	const query = c.req.valid("query");

	const dashboard = await hostService.getDashboard(user, query);

	return c.json(dashboard, 200);
});

hostRouter.openapi(getHostIncomeRoute, async (c) => {
	const user = getCurrentUser(c);
	const query = c.req.valid("query");

	const income = await hostService.getIncome(user, query);

	return c.json(income, 200);
});

hostRouter.openapi(getHostReviewsRoute, async (c) => {
	const user = getCurrentUser(c);
	const query = c.req.valid("query");

	const reviews = await hostService.getReviews(user, query);

	return c.json(reviews, 200);
});

hostRouter.openapi(listHostBookingsRoute, async (c) => {
	const user = getCurrentUser(c);
	const query = c.req.valid("query");

	const bookings = await hostService.findBookings(user, query);

	return c.json(paginated(bookings.data, bookings.meta), 200);
});

hostRouter.openapi(updateHostBookingStatusRoute, async (c) => {
	const user = getCurrentUser(c);
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");

	const booking = await hostService.updateBookingStatus(user, id, body);

	return c.json(booking, 200);
});
