import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { AuthFormAlert } from "../components/AuthFormAlert";
import { useChangePasswordForm } from "../hooks/useChangePasswordForm";

export default function ChangePasswordPage() {
	const { formData, loading, error, success, handleChange, handleSubmit } =
		useChangePasswordForm();
	const { t } = useTranslation();
	const alertMessage =
		error?.message || (success ? t("auth.changePasswordSuccess") : "");

	return (
		<section className="mx-auto flex max-w-7xl justify-center px-6 py-16 md:py-20">
			<div className="w-full max-w-md">
				<PageHeader
					eyebrow={t("auth.changePasswordEyebrow")}
					title={t("auth.changePasswordTitle")}
				/>

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<label htmlFor="currentPassword" className="sr-only">
						{t("auth.currentPassword")}
					</label>
					<Input
						id="currentPassword"
						name="currentPassword"
						type="password"
						value={formData.currentPassword}
						onChange={handleChange}
						autoComplete="current-password"
						placeholder={t("auth.currentPassword")}
						required
					/>

					<label htmlFor="newPassword" className="sr-only">
						{t("auth.newPassword")}
					</label>
					<Input
						id="newPassword"
						name="newPassword"
						type="password"
						value={formData.newPassword}
						onChange={handleChange}
						autoComplete="new-password"
						placeholder={t("auth.newPassword")}
						required
					/>

					<Button type="submit" disabled={loading} className="mt-4 w-full">
						{loading ? t("auth.updatingPassword") : t("auth.updatePassword")}
					</Button>

					<AuthFormAlert
						message={alertMessage}
						variant={error ? "error" : "info"}
					/>
				</form>

				<p className="mt-6 text-center font-medium text-muted-foreground text-sm">
					<Link
						to=".."
						className="font-bold text-primary transition-colors hover:text-clay-dark"
					>
						{t("auth.backToAccount")}
					</Link>
				</p>
			</div>
		</section>
	);
}
