import { FaStar } from "react-icons/fa6";

const starKeys = ["star-1", "star-2", "star-3", "star-4", "star-5"];

interface StarRatingProps {
	rating: number;
}

export function StarRating({ rating }: StarRatingProps) {
	return (
		<div
			className="flex gap-1 text-clay"
			role="img"
			aria-label={`${rating} out of 5 stars`}
		>
			{starKeys.map((starKey, index) => (
				<FaStar
					key={starKey}
					aria-hidden="true"
					className={index < rating ? "text-clay" : "text-line"}
				/>
			))}
		</div>
	);
}
