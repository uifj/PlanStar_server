import { useTranslation } from "@/shared/i18n";

export default function Footer() {
	const { t } = useTranslation();

	return (
		<footer className="bg-forest py-8 text-center font-medium text-secondary text-sm">
			{t("footer.copyright")}
		</footer>
	);
}
