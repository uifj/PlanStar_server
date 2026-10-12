import app from "../../../src/app.js";

type RequestOptions = {
	headers?: HeadersInit;
};

const jsonHeaders = {
	"Content-Type": "application/json",
};

export function get(path: string, options?: RequestOptions) {
	return app.request(path, {
		headers: options?.headers,
	});
}

export function post(path: string, body: unknown, options?: RequestOptions) {
	return app.request(path, {
		method: "POST",
		headers: {
			...jsonHeaders,
			...options?.headers,
		},
		body: JSON.stringify(body),
	});
}

export function patch(path: string, body: unknown, options?: RequestOptions) {
	return app.request(path, {
		method: "PATCH",
		headers: {
			...jsonHeaders,
			...options?.headers,
		},
		body: JSON.stringify(body),
	});
}

export function del(path: string, options?: RequestOptions) {
	return app.request(path, {
		method: "DELETE",
		headers: options?.headers,
	});
}
