import { Moon, Sun } from "lucide-react";
import { RxAvatar } from "react-icons/rx";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/modules/auth/context/AuthProvider";
import { authRoutePaths } from "@/modules/auth/routes";
import { Nav } from "@/shared/components/Nav";
import { LANGUAGE_LABELS, LANGUAGES, useTranslation } from "@/shared/i18n";
import { useTheme } from "@/shared/theme";
import { getHeaderNavigation } from "../routes/navigation";
import { paths } from "../routes/paths";

export default function Header() {
	const { user } = useAuth();
	const { t, language, setLanguage } = useTranslation();
	const { theme, toggleTheme } = useTheme();
	const headerNavigation = getHeaderNavigation(user?.role, t);

	return (
		<header className="border-border border-b bg-background/95">
			<div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
				<Link
					to={paths.home}
					className="font-black text-2xl text-foreground transition-colors hover:text-primary"
				>
					{t("header.title")}
				</Link>
				<div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 sm:justify-end sm:gap-6">
					<Nav
						links={headerNavigation}
						ariaLabel={t("header.primaryNav")}
						className="flex-wrap gap-x-5 gap-y-2 sm:gap-6"
					/>
					<div className="flex items-center gap-3">
						<fieldset
							className="flex items-center rounded-md border border-border"
							aria-label={t("header.switchLanguage")}
						>
							{LANGUAGES.map((lang) => (
								<Button
									key={lang}
									type="button"
									variant="ghost"
									size="sm"
									onClick={() => setLanguage(lang)}
									className={
										lang === language
											? "bg-foreground text-secondary"
											: "text-muted-foreground hover:bg-transparent hover:text-foreground"
									}
								>
									{LANGUAGE_LABELS[lang]}
								</Button>
							))}
						</fieldset>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							onClick={toggleTheme}
							aria-label={t("header.toggleTheme")}
						>
							{theme === "dark" ? (
								<Sun aria-hidden="true" />
							) : (
								<Moon aria-hidden="true" />
							)}
						</Button>
						{user ? null : (
							<Link
								to={authRoutePaths.signIn}
								aria-label={t("header.signIn")}
								className="text-muted-foreground transition-colors hover:text-primary"
							>
								<RxAvatar className="size-6" />
							</Link>
						)}
					</div>
				</div>
			</div>
		</header>
	);
}
