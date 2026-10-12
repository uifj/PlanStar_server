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
