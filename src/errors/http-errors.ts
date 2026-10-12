import { AppError } from "./app-error.js";

export class BadRequestError extends AppError {
	constructor(message = "The request could not be processed.") {
		super(message, 400);
	}
}

export class UnauthorizedError extends AppError {
	constructor(message = "Please sign in to continue.") {
		super(message, 401);
	}
}

export class ForbiddenError extends AppError {
	constructor(message = "You do not have permission to access this resource.") {
		super(message, 403);
	}
}

export class NotFoundError extends AppError {
	constructor(message = "Resource not found.") {
		super(message, 404);
	}
}

export class ConflictError extends AppError {
	constructor(
		message = "The request conflicts with the current resource state.",
	) {
		super(message, 409);
	}
}

export class ValidationError extends AppError {
	constructor(message = "Validation failed") {
		super(message, 422);
	}
}

export class ServiceUnavailableError extends AppError {
	constructor(message = "Service unavailable") {
		super(message, 503);
	}
}
