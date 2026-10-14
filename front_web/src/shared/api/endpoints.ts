export const apiPaths = {
	auth: {
		changePassword: "/auth/change-password",
		signInEmail: "/auth/sign-in/email",
		signOut: "/auth/sign-out",
		signUpEmail: "/auth/sign-up/email",
	},

	me: "/me",

	vans: {
		list: "/vans",
		detail: (id: string) => `/vans/${id}`,
	},

	bookings: {
		list: "/bookings",
		cancel: (id: string) => `/bookings/${id}/cancel`,
		reviews: "/reviews",
	},

	agent: {
		tripPlanner: "/agent/trip-planner/messages",
	},

	spaces: {
		list: "/spaces",

		relations: (spaceId: string) => `/spaces/${spaceId}/relations`,
		objectTypes: (spaceId: string) => `/spaces/${spaceId}/object-types`,
		objects: (spaceId: string) => `/spaces/${spaceId}/objects`,
		participants: (spaceId: string) => `/spaces/${spaceId}/participants`,
		participant: (spaceId: string, participantId: string) =>
			`/spaces/${spaceId}/participants/${participantId}`,
	},

	objects: {
		detail: (objectId: string) => `/objects/${objectId}`,
		blocks: (objectId: string) => `/objects/${objectId}/blocks`,
		backlinks: (objectId: string) => `/objects/${objectId}/backlinks`,
	},

	blocks: {
		item: (blockId: string) => `/blocks/${blockId}`,
	},

	host: {
		dashboard: "/host/dashboard",
		income: "/host/income",
		register: "/register/host",

		vans: {
			list: "/host/vans",
			detail: (id: string) => `/host/vans/${id}`,
		},

		bookings: {
			list: "/host/bookings",
			updateStatus: (id: string) => `/host/bookings/${id}/status`,
		},

		reviews: "/host/reviews",
	},
} as const;
