import { Link } from "react-router";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { paths } from "../routes/paths";

export default function NotFoundPage() {
	const { t } = useTranslation();

	return (
		<section className="mx-auto flex min-h-96 max-w-7xl flex-col items-center justify-center px-6 py-20 text-center">
			<PageHeader
				eyebrow={t("notFound.eyebrow")}
				title={t("notFound.title")}
				className="mb-0 items-center"
				titleClassName="max-w-2xl"
			/>
			<p className="mt-6 max-w-lg font-medium text-lg text-muted-foreground leading-8">
				{t("notFound.message")}
			</p>

			<Link to={paths.home} className={cn(buttonVariants(), "mt-10")}>
				{t("notFound.backHome")}
			</Link>
		</section>
	);
}
