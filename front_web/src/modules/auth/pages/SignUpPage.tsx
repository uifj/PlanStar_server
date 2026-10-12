import { Link } from "react-router";
import { Input } from "@/shared/components/Input";
import { PageHeader } from "@/shared/components/PageHeader";
import { AuthFormAlert } from "../components/AuthFormAlert";
import { useSignUpForm } from "../hooks/useSignUpForm";
import { authRoutePaths } from "../routes";

export default function SignUpPage() {
	const { formData, loading, error, success, handleChange, handleSubmit } =
		useSignUpForm();
	const alertMessage =
		error?.message ||
		(success ? "Account created. Taking you to your bookings." : "");

	return (
		<section className="mx-auto flex max-w-7xl justify-center px-6 py-16 md:py-20">
			<div className="w-full max-w-md">
				<PageHeader
					eyebrow="Create account"
					title="Start your VanLife trips."
				/>

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<label htmlFor="name" className="sr-only">
						Name
					</label>
					<Input
						id="name"
						name="name"
						value={formData.name}
						onChange={handleChange}
						autoComplete="name"
						placeholder="Name"
						required
					/>

					<label htmlFor="email" className="sr-only">
						Email address
					</label>
					<Input
						id="email"
						name="email"
						type="email"
						value={formData.email}
						onChange={handleChange}
						autoComplete="email"
						placeholder="Email address"
						required
					/>

					<label htmlFor="password" className="sr-only">
						Password
					</label>
					<Input
						id="password"
						name="password"
						type="password"
						value={formData.password}
						onChange={handleChange}
						autoComplete="new-password"
						placeholder="Password"
						required
					/>

					<fieldset>
						<legend className="font-semibold text-muted text-sm">
							Account type
						</legend>
						<div className="mt-3 overflow-hidden rounded-lg border border-line bg-surface">
							<label
								htmlFor="role-user"
								className="group flex gap-4 p-4 transition-colors has-checked:bg-panel has-focus-visible:ring-2 has-focus-visible:ring-clay"
							>
								<input
									id="role-user"
									name="role"
									type="radio"
									value="user"
									checked={formData.role === "user"}
									onChange={handleChange}
									className="sr-only"
								/>
								<span
									aria-hidden="true"
									className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line bg-surface group-has-checked:border-clay"
								>
									<span className="size-2.5 rounded-full bg-clay opacity-0 transition-opacity group-has-checked:opacity-100" />
								</span>
								<span>
									<span className="block font-bold text-ink">Renter</span>
									<span className="mt-1 block text-muted text-sm leading-6">
										Book vans for your next trip.
									</span>
								</span>
							</label>
							<label
								htmlFor="role-host"
								className="group flex gap-4 border-line border-t p-4 transition-colors has-checked:bg-panel has-focus-visible:ring-2 has-focus-visible:ring-clay"
							>
								<input
									id="role-host"
									name="role"
									type="radio"
									value="host"
									checked={formData.role === "host"}
									onChange={handleChange}
									className="sr-only"
								/>
								<span
									aria-hidden="true"
									className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line bg-surface group-has-checked:border-clay"
								>
									<span className="size-2.5 rounded-full bg-clay opacity-0 transition-opacity group-has-checked:opacity-100" />
								</span>
								<span>
									<span className="block font-bold text-ink">Host</span>
									<span className="mt-1 block text-muted text-sm leading-6">
										Share your van and manage guests.
									</span>
								</span>
							</label>
						</div>
					</fieldset>

					<button
						type="submit"
						disabled={loading}
						className="mt-4 rounded-lg bg-clay py-4 font-bold text-base text-surface transition-colors hover:bg-clay-dark active:scale-95 disabled:bg-soft disabled:text-panel"
					>
						{loading ? "Creating account..." : "Create account"}
					</button>

					<AuthFormAlert
						message={alertMessage}
						variant={error ? "error" : "info"}
					/>
				</form>

				<p className="mt-6 text-center font-medium text-muted text-sm">
					Already have an account?{" "}
					<Link
						to={`/${authRoutePaths.signIn}`}
						className="font-bold text-clay transition-colors hover:text-clay-dark"
					>
						Sign in
					</Link>
				</p>
			</div>
		</section>
	);
}
