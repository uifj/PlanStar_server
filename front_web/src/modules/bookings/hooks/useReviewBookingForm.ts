import { type ChangeEvent, type SubmitEvent, useState } from "react";
import { useCreateReview } from "./useCreateReview";

export function useReviewBookingForm(bookingId: string) {
	const [rating, setRating] = useState(5);
	const [text, setText] = useState("");
	const [formError, setFormError] = useState("");
	const { createReview, loading, error, success } = useCreateReview();

	const buttonText = loading ? "Sending review..." : "Submit review";
	const statusMessage =
		formError ||
		error?.message ||
		(success ? "Thanks. Your review has been submitted." : "");

	function handleRatingChange(nextRating: number) {
		setRating(nextRating);
	}

	function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
		setText(event.target.value);
	}

	function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!text.trim()) {
			setFormError("Write a short review before submitting.");
			return;
		}

		setFormError("");

		createReview({
			bookingId,
			rating,
			text: text.trim(),
		});
	}

	return {
		rating,
		text,
		loading,
		success,
		buttonText,
		statusMessage,
		handleRatingChange,
		handleTextChange,
		handleSubmit,
	};
}
