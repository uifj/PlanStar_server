import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PageHeader } from "@/shared/components/PageHeader";
import { useTranslation } from "@/shared/i18n";
import { AuthFormAlert } from "../components/AuthFormAlert";
import { useSignUpForm } from "../hooks/useSignUpForm";
import { authRoutePaths } from "../routes";

export default function SignUpPage() {
	const {
		formData,
		loading,
		error,
		success,
		handleChange,
		handleRoleChange,
		handleSubmit,
	} = useSignUpForm();
	const { t } = useTranslation();
	const alertMessage =
		error?.message || (success ? t("auth.signUpSuccess") : "");

	return (
		<section className="mx-auto flex max-w-7xl justify-center px-6 py-16 md:py-20">
			<div className="w-full max-w-md">
				<PageHeader
					eyebrow={t("auth.signUpEyebrow")}
					title={t("auth.signUpTitle")}
				/>

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<label htmlFor="name" className="sr-only">
						{t("auth.name")}
					</label>
					<Input
						id="name"
						name="name"
						value={formData.name}
						onChange={handleChange}
						autoComplete="name"
						placeholder={t("auth.name")}
						required
					/>

					<label htmlFor="email" className="sr-only">
						{t("auth.email")}
					</label>
					<Input
						id="email"
						name="email"
						type="email"
						value={formData.email}
						onChange={handleChange}
						autoComplete="email"
						placeholder={t("auth.email")}
						required
					/>

					<label htmlFor="password" className="sr-only">
						{t("auth.password")}
					</label>
					<Input
						id="password"
						name="password"
						type="password"
						value={formData.password}
						onChange={handleChange}
						autoComplete="new-password"
						placeholder={t("auth.password")}
						required
					/>

					<fieldset>
						<legend className="font-semibold text-muted-foreground text-sm">
							{t("auth.accountType")}
						</legend>
						<RadioGroup
							value={formData.role}
							onValueChange={handleRoleChange}
							className="mt-3 grid overflow-hidden rounded-lg border border-border bg-card [&>label:first-child]:border-t-0 [&>label]:border-border [&>label]:border-t"
						>
							<label
								htmlFor="role-user"
								className="group flex gap-4 p-4 transition-colors has-data-[state=checked]:bg-secondary has-focus-visible:ring-2 has-focus-visible:ring-ring"
							>
								<RadioGroupItem
									id="role-user"
									value="user"
									className="mt-0.5"
								/>
								<span>
									<span className="block font-bold text-foreground">
										{t("auth.renter")}
									</span>
									<span className="mt-1 block text-muted-foreground text-sm leading-6">
										{t("auth.renterDescription")}
									</span>
								</span>
							</label>
							<label
								htmlFor="role-host"
								className="group flex gap-4 p-4 transition-colors has-data-[state=checked]:bg-secondary has-focus-visible:ring-2 has-focus-visible:ring-ring"
							>
								<RadioGroupItem
									id="role-host"
									value="host"
									className="mt-0.5"
								/>
								<span>
									<span className="block font-bold text-foreground">
										{t("auth.host")}
									</span>
									<span className="mt-1 block text-muted-foreground text-sm leading-6">
										{t("auth.hostDescription")}
									</span>
								</span>
							</label>
						</RadioGroup>
					</fieldset>

					<Button type="submit" disabled={loading} className="mt-4 w-full">
						{loading ? t("auth.creatingAccount") : t("auth.signUpEyebrow")}
					</Button>

					<AuthFormAlert
						message={alertMessage}
						variant={error ? "error" : "info"}
					/>
				</form>

				<p className="mt-6 text-center font-medium text-muted-foreground text-sm">
					{t("auth.alreadyHaveAccount")}{" "}
					<Link
						to={`/${authRoutePaths.signIn}`}
						className="font-bold text-primary transition-colors hover:text-clay-dark"
					>
						{t("auth.signIn")}
					</Link>
				</p>
			</div>
		</section>
	);
}
