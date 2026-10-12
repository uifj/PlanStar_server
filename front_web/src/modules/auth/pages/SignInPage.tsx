import { Link } from "react-router";
import { Input } from "@/shared/components/Input";
import { PageHeader } from "@/shared/components/PageHeader";
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

	return (
		<section className="mx-auto flex max-w-7xl justify-center px-6 py-16 md:py-20">
			<div className="w-full max-w-md">
				<PageHeader eyebrow="Account access" title="Sign in to your account." />

				<form onSubmit={handleSubmit} className="flex flex-col gap-4">
					<label htmlFor="email" className="sr-only">
						Email address
					</label>
					<Input
						id="email"
						name="email"
						type="email"
						onChange={handleChange}
						autoComplete="email"
						placeholder="Email address"
						value={signInFormData.email}
						required
					/>

					<label htmlFor="password" className="sr-only">
						Password
					</label>
					<Input
						id="password"
						name="password"
						type="password"
						onChange={handleChange}
						placeholder="Password"
						value={signInFormData.password}
						required
					/>

					<button
						type="submit"
						disabled={loading}
						className="mt-4 rounded-lg bg-clay py-4 font-bold text-base text-surface transition-colors hover:bg-clay-dark active:scale-95 disabled:bg-soft disabled:text-panel"
					>
						{loading ? "Signing in..." : "Sign in"}
					</button>

					<AuthFormAlert
						message={error ?? message}
						variant={error ? "error" : "info"}
					/>
				</form>

				<p className="mt-6 text-center font-medium text-muted text-sm">
					New to VanLife?{" "}
					<Link
						to={`/${authRoutePaths.signUp}`}
						className="font-bold text-clay transition-colors hover:text-clay-dark"
					>
						Create an account
					</Link>
				</p>
			</div>
		</section>
	);
}
