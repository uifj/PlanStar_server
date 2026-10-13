import { Link } from "react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Alert } from "@/shared/components/Alert";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { AccountLoadingState } from "../components/AccountLoadingState";
import { useSignOut } from "../hooks/useSignOut";
import { useUser } from "../hooks/useUser";
import { authRoutePaths } from "../routes";

export default function AccountPage() {
	const { user, loading: userLoading, error } = useUser();
	const {
		signOut,
		loading: signOutLoading,
		error: signOutError,
	} = useSignOut();
	const { t } = useTranslation();

	function handleSignOut() {
		signOut();
	}

	return (
		<section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
			<PageHeader
				eyebrow={t("auth.accountEyebrow")}
				title={t("auth.accountTitle")}
			/>

			<div className="mx-auto max-w-3xl">
				{userLoading ? <AccountLoadingState /> : null}

				{error ? (
					<Alert variant="error">{t("auth.accountLoadError")}</Alert>
				) : null}

				{user ? (
					<div className="grid gap-6">
						<header className="rounded-lg bg-secondary p-6 md:p-8">
							<p className="font-semibold text-primary text-sm">
								{user.role === "host"
									? t("auth.hostAccount")
									: t("auth.renterAccount")}
							</p>
							<h2 className="mt-2 text-balance font-black text-3xl text-foreground md:text-4xl">
								{user.name}
							</h2>
							<p className="wrap-break-word mt-2 font-medium text-muted-foreground">
								{user.email}
							</p>
						</header>

						<div className="rounded-lg bg-card p-6 shadow-sm md:p-8">
							<h2 className="font-bold text-2xl text-foreground">
								{t("auth.security")}
							</h2>
							<p className="mt-2 text-muted-foreground text-sm leading-6">
								{t("auth.securityHint")}
							</p>

							<dl className="mt-4 divide-y divide-border">
								<div className="grid gap-3 py-4 sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-6">
									<dt className="font-semibold text-muted-foreground text-sm">
										{t("auth.password")}
									</dt>
									<dd className="font-bold text-foreground">••••••••</dd>
									<Link
										to={authRoutePaths.changePassword}
										className={cn(
											buttonVariants({ size: "sm" }),
											"bg-foreground text-card hover:bg-forest",
										)}
									>
										{t("auth.change")}
									</Link>
								</div>
							</dl>

							<div className="mt-2 border-border border-t pt-4">
								{signOutError ? (
									<div className="mb-4">
										<Alert variant="error">{t("auth.signOutError")}</Alert>
									</div>
								) : null}

								<Button
									type="button"
									variant="ghost"
									onClick={handleSignOut}
									disabled={signOutLoading}
									className="h-auto px-0 font-bold text-primary hover:bg-transparent hover:text-primary"
								>
									{signOutLoading ? t("auth.signingOut") : t("auth.signOut")}
								</Button>
							</div>
						</div>
					</div>
				) : null}
			</div>
		</section>
	);
}
