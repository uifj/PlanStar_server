import { getCurrentUser } from "../../auth/current-user.js";
import { createProtectedRouter } from "../../auth/protected-router.js";
import { paginated } from "../../response/payload.js";
import {
	cancelBookingRoute,
	createBookingRoute,
	listBookingsRoute,
} from "./routes.js";
import { bookingService } from "./service.js";

export const bookingsRouter = createProtectedRouter();

bookingsRouter.openapi(listBookingsRoute, async (c) => {
	const query = c.req.valid("query");
	const user = getCurrentUser(c);

	const bookings = await bookingService.findMany(user, query);

	return c.json(paginated(bookings.data, bookings.meta));
});

bookingsRouter.openapi(createBookingRoute, async (c) => {
	const body = c.req.valid("json");
	const user = getCurrentUser(c);

	const booking = await bookingService.create(user, body);

	return c.json(booking, 201);
});

bookingsRouter.openapi(cancelBookingRoute, async (c) => {
	const { id } = c.req.valid("param");
	const user = getCurrentUser(c);

	const booking = await bookingService.cancel(user, id);

	return c.json(booking);
});
