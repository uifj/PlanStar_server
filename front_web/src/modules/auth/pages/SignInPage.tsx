import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { AuthFormAlert } from "../components/AuthFormAlert";
import { useSignInForm } from "../hooks/useSignInForm";
import { authRoutePaths } from "../routes";

export default function SignInPage() {
	const {
		signInFormData,
		loading,
		error,
		message,
		handleChange,
		handleSubmit,
	} = useSignInForm();
	const { t } = useTranslation();

	return (
		<section className="mx-auto flex max-w-7xl justify-center px-6 py-16 md:py-20">
			<div className="w-full max-w-md">
				<PageHeader
					eyebrow={t("auth.signInEyebrow")}
					title={t("auth.signInTitle")}
				/>

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<label htmlFor="email" className="sr-only">
						{t("auth.email")}
					</label>
					<Input
						id="email"
						name="email"
						type="email"
						onChange={handleChange}
						autoComplete="email"
						placeholder={t("auth.email")}
						value={signInFormData.email}
						required
					/>

					<label htmlFor="password" className="sr-only">
						{t("auth.password")}
					</label>
					<Input
						id="password"
						name="password"
						type="password"
						onChange={handleChange}
						placeholder={t("auth.password")}
						value={signInFormData.password}
						required
					/>

					<Button type="submit" disabled={loading} className="mt-4 w-full">
						{loading ? t("auth.signingIn") : t("auth.signIn")}
					</Button>

					<AuthFormAlert
						message={error ?? message}
						variant={error ? "error" : "info"}
					/>
				</form>

				<p className="mt-6 text-center font-medium text-muted-foreground text-sm">
					{t("auth.newToVanLife")}{" "}
					<Link
						to={`/${authRoutePaths.signUp}`}
						className="font-bold text-primary transition-colors hover:text-clay-dark"
					>
						{t("auth.createAccount")}
					</Link>
				</p>
			</div>
		</section>
	);
}
