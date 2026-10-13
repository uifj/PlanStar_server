import { type ChangeEvent, type SubmitEvent, useState } from "react";
import { useTranslation } from "@/shared/i18n";
import { useCreateReview } from "./useCreateReview";

export function useReviewBookingForm(bookingId: string) {
	const [rating, setRating] = useState(5);
	const [text, setText] = useState("");
	const [formError, setFormError] = useState("");
	const { createReview, loading, error, success } = useCreateReview();
	const { t } = useTranslation();

	const buttonText = loading
		? t("bookings.sendingReview")
		: t("bookings.submitReview");
	const statusMessage =
		formError ||
		error?.message ||
		(success ? t("bookings.reviewSubmitted") : "");

	function handleRatingChange(nextRating: number) {
		setRating(nextRating);
	}

	function handleTextChange(event: ChangeEvent<HTMLTextAreaElement>) {
		setText(event.target.value);
	}

	function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();

		if (!text.trim()) {
			setFormError(t("bookings.reviewEmptyError"));
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
