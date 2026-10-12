import { useMutation } from "@tanstack/react-query";
import { createBooking } from "../services/bookingService";

export function useCreateBooking() {
	const { mutate, isPending, error, data, isSuccess, reset } = useMutation({
		mutationFn: createBooking,
	});

	return {
		createBooking: mutate,
		booking: data,
		loading: isPending,
		error,
		success: isSuccess,
		reset,
	};
}
