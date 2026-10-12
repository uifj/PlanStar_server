import { Link } from "react-router";
import { Input } from "@/shared/components/Input";
import { PageHeader } from "@/shared/components/PageHeader";
import { AuthFormAlert } from "../components/AuthFormAlert";
import { useChangePasswordForm } from "../hooks/useChangePasswordForm";

export default function ChangePasswordPage() {
	const { formData, loading, error, success, handleChange, handleSubmit } =
		useChangePasswordForm();
	const alertMessage =
		error?.message || (success ? "Your password has been updated." : "");

	return (
		<section className="mx-auto flex max-w-7xl justify-center px-6 py-16 md:py-20">
			<div className="w-full max-w-md">
				<PageHeader eyebrow="Account security" title="Change your password." />

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<label htmlFor="currentPassword" className="sr-only">
						Current password
					</label>
					<Input
						id="currentPassword"
						name="currentPassword"
						type="password"
						value={formData.currentPassword}
						onChange={handleChange}
						autoComplete="current-password"
						placeholder="Current password"
						required
					/>

					<label htmlFor="newPassword" className="sr-only">
						New password
					</label>
					<Input
						id="newPassword"
						name="newPassword"
						type="password"
						value={formData.newPassword}
						onChange={handleChange}
						autoComplete="new-password"
						placeholder="New password"
						required
					/>

					<button
						type="submit"
						disabled={loading}
						className="mt-4 rounded-lg bg-clay py-4 font-bold text-base text-surface transition-colors hover:bg-clay-dark active:scale-95 disabled:bg-soft disabled:text-panel"
					>
						{loading ? "Updating password..." : "Update password"}
					</button>

					<AuthFormAlert
						message={alertMessage}
						variant={error ? "error" : "info"}
					/>
				</form>

				<p className="mt-6 text-center font-medium text-muted text-sm">
					<Link
						to=".."
						className="font-bold text-clay transition-colors hover:text-clay-dark"
					>
						Back to account
					</Link>
				</p>
			</div>
		</section>
	);
}
