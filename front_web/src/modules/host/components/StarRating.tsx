import { FaStar } from "react-icons/fa6";
import { useTranslation } from "@/shared/i18n";

const starKeys = ["star-1", "star-2", "star-3", "star-4", "star-5"];

interface StarRatingProps {
	rating: number;
}

export function StarRating({ rating }: StarRatingProps) {
	const { t } = useTranslation();

	return (
		<div
			className="flex gap-1 text-primary"
			role="img"
			aria-label={t("host.reviews.starsOutOf", { rating })}
		>
			{starKeys.map((starKey, index) => (
				<FaStar
					key={starKey}
					aria-hidden="true"
					className={index < rating ? "text-primary" : "text-border"}
				/>
			))}
		</div>
	);
}
