import { Link } from "react-router";
import { PageHeader } from "@/shared/components/PageHeader";
import { paths } from "../routes/paths";

export default function NotFoundPage() {
	return (
		<section className="mx-auto flex min-h-96 max-w-7xl flex-col items-center justify-center px-6 py-20 text-center">
			<PageHeader
				eyebrow="Page not found"
				title="This road does not lead anywhere."
				className="mb-0 items-center"
				titleClassName="max-w-2xl"
			/>
			<p className="mt-6 max-w-lg font-medium text-lg text-muted leading-8">
				The page may have moved, or the address may need another look.
			</p>

			<Link
				to={paths.home}
				className="mt-10 inline-flex rounded-lg bg-clay px-6 py-3 font-bold text-surface transition-colors hover:bg-clay-dark active:scale-95"
			>
				Return to home
			</Link>
		</section>
	);
}
