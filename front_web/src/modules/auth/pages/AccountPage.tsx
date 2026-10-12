import { Link } from "react-router";
import { Alert } from "@/shared/components/Alert";
import { PageHeader } from "@/shared/components/PageHeader";
import { AccountLoadingState } from "../components/AccountLoadingState";
import { useSignOut } from "../hooks/useSignOut";
import { useUser } from "../hooks/useUser";
import { authRoutePaths } from "../routes";
import type { AuthRole } from "../types";

function getRoleLabel(role: AuthRole) {
	return role === "host" ? "Host account" : "Renter account";
}

export default function AccountPage() {
	const { user, loading: userLoading, error } = useUser();
	const {
		signOut,
		loading: signOutLoading,
		error: signOutError,
	} = useSignOut();

	function handleSignOut() {
		signOut();
	}

	return (
		<section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
			<PageHeader
				eyebrow="Your account"
				title="Manage your account and password."
			/>

			<div className="mx-auto max-w-3xl">
				{userLoading ? <AccountLoadingState /> : null}

				{error ? (
					<Alert variant="error">
						We could not load your account details. Please try again.
					</Alert>
				) : null}

				{user ? (
					<div className="grid gap-6">
						<header className="rounded-lg bg-panel p-6 md:p-8">
							<p className="font-semibold text-clay text-sm">
								{getRoleLabel(user.role)}
							</p>
							<h2 className="mt-2 text-balance font-black text-3xl text-ink md:text-4xl">
								{user.name}
							</h2>
							<p className="wrap-break-word mt-2 font-medium text-muted">
								{user.email}
							</p>
						</header>

						<div className="rounded-lg bg-surface p-6 shadow-sm md:p-8">
							<h2 className="font-bold text-2xl text-ink">Security</h2>
							<p className="mt-2 text-muted text-sm leading-6">
								Keep your password fresh and sign out when you finish using a
								shared device.
							</p>

							<dl className="mt-4 divide-y divide-line">
								<div className="grid gap-3 py-4 sm:grid-cols-[9rem_1fr_auto] sm:items-center sm:gap-6">
									<dt className="font-semibold text-muted text-sm">Password</dt>
									<dd className="font-bold text-ink">••••••••</dd>
									<Link
										to={authRoutePaths.changePassword}
										className="w-fit rounded-lg bg-ink px-4 py-2 font-bold text-sm text-surface transition-colors hover:bg-forest active:scale-95"
									>
										Change
									</Link>
								</div>
							</dl>

							<div className="mt-2 border-line border-t pt-4">
								{signOutError ? (
									<div className="mb-4">
										<Alert variant="error">
											We could not sign you out. Please try again.
										</Alert>
									</div>
								) : null}

								<button
									type="button"
									onClick={handleSignOut}
									disabled={signOutLoading}
									className="font-bold text-clay text-sm transition-colors hover:text-clay-dark active:scale-95"
								>
									{signOutLoading ? "Signing out..." : "Sign out"}
								</button>
							</div>
						</div>
					</div>
				) : null}
			</div>
		</section>
	);
}
