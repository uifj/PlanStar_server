import { Moon, Sun } from "lucide-react";
import { RxAvatar } from "react-icons/rx";
import { Link, NavLink, Outlet, useSearchParams } from "react-router";
import { Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/modules/auth/context/AuthProvider";
import { authRoutePaths } from "@/modules/auth/routes";
import { useSpaceRegistry } from "@/modules/spaces/hooks/useSpaceRegistry";
import { useSpaces } from "@/modules/spaces/hooks/useSpaces";
import { spaceBrowserLink, spaceTypeLink } from "@/modules/spaces/routes";
import { LANGUAGE_LABELS, LANGUAGES, useTranslation } from "@/shared/i18n";
import { useTheme } from "@/shared/theme";
import { getHeaderNavigation } from "../routes/navigation";
import { paths } from "../routes/paths";
import Footer from "./Footer";
import { ObjectContextPanel } from "./ObjectContextPanel";

const railItem =
	"rounded-md px-3 py-2 font-medium text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground";
const railItemActive = "bg-accent text-foreground";

export default function RootLayout() {
	const { t, language, setLanguage } = useTranslation();
	const { theme, toggleTheme } = useTheme();
	const { user } = useAuth();
	const [searchParams, setSearchParams] = useSearchParams();
	const activeSpaceId = searchParams.get("spaceId") ?? "";
	const activeTypeId = searchParams.get("typeId") ?? "";
	const focusId = searchParams.get("focus") ?? "";
	const { spaces } = useSpaces();
	const { types } = useSpaceRegistry(activeSpaceId || undefined);
	const navigation = getHeaderNavigation(user?.role, t);

	function clearFocus() {
		const next = new URLSearchParams(searchParams);

		next.delete("focus");
		setSearchParams(next);
	}

	return (
		<div className="flex min-h-dvh bg-background text-foreground">
			<nav
				aria-label={t("header.primaryNav")}
				className="flex w-60 shrink-0 flex-col gap-1 border-border border-r px-2 py-4"
			>
				<Link
					to={paths.home}
					className="font-black text-foreground text-lg transition-colors hover:text-primary"
				>
					{t("header.title")}
				</Link>

				{navigation.map((link) => (
					<NavLink
						key={link.to}
						to={link.to}
						end={link.end}
						className={({ isActive }) =>
							cn(railItem, isActive && railItemActive)
						}
					>
						{link.label}
					</NavLink>
				))}

				{spaces.length === 0 ? null : (
					<div className="mt-4 flex flex-col gap-1">
						<span className="px-3 font-semibold text-muted-foreground text-xs uppercase">
							{t("spaces.rail")}
						</span>
						{spaces.map((space) => (
							<div key={space.id} className="flex flex-col gap-1">
								<Link
									to={spaceBrowserLink(space.id)}
									aria-current={space.id === activeSpaceId ? "page" : undefined}
									className={cn(
										railItem,
										space.id === activeSpaceId && railItemActive,
									)}
								>
									{space.name}
								</Link>
								{space.id === activeSpaceId
									? types.map((type) => (
											<Link
												key={type.id}
												to={spaceTypeLink(space.id, type.id)}
												aria-current={
													type.id === activeTypeId ? "page" : undefined
												}
												className={cn(
													railItem,
													"pl-6",
													type.id === activeTypeId && railItemActive,
												)}
											>
												{type.name}
											</Link>
										))
									: null}
							</div>
						))}
					</div>
				)}

				<div className="mt-auto flex flex-col gap-3 pt-6">
					<fieldset className="flex items-center gap-1 rounded-md border border-border px-1 py-1">
						<legend className="sr-only">{t("header.switchLanguage")}</legend>
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

					<div className="flex items-center gap-2">
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
			</nav>

			<main className="flex min-w-0 flex-1 flex-col">
				<div className="flex-1">
					<Outlet />
				</div>

				<Footer />
			</main>

			{focusId ? (
				<ObjectContextPanel objectId={focusId} onClose={clearFocus} />
			) : null}

			<Toaster position="bottom-right" theme={theme} />
		</div>
	);
}
