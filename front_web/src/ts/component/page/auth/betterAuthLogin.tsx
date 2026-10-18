import { Button, Error, Footer, Frame, Header, Input, Label } from "Component";
import type * as I from "Interface";
import { signIn, signUp } from "Lib/api/better-auth";
// Classic JSX runtime: React must stay a value import or every element fails to compile.
import React, { forwardRef, useRef, useState } from "react";

// `Error` is shadowed in this module by the imported Error component, so read
// the message off the thrown value without relying on the global Error class.
const thrownMessage = (err: unknown, fallback: string): string => {
	const message =
		err && typeof err === "object" && "message" in err
			? (err as { message?: unknown }).message
			: undefined;
	return typeof message === "string" && message ? message : fallback;
};

const PageAuthBetterLogin = forwardRef<I.PageRef, I.PageComponent>(
	(props, ref) => {
		const nodeRef = useRef(null);
		const emailRef = useRef(null);
		const passwordRef = useRef(null);
		const submitRef = useRef(null);
		const [error, setError] = useState("");
		const [isRegister, setIsRegister] = useState(false);
		const [name, setName] = useState("");

		const onSubmit = async (e: React.FormEvent) => {
			e.preventDefault();
			setError("");

			const email = emailRef.current?.getValue() || "";
			const password = passwordRef.current?.getValue() || "";

			if (!email || !password) {
				setError(translate("pageAuthLoginEmptyFields"));
				return;
			}

			if (password.length < 8) {
				setError(translate("authPasswordPlaceholder"));
				return;
			}

			submitRef.current?.setLoading(true);

			try {
				if (isRegister) {
					const result = await signUp.email({
						email,
						password,
						name: name || email.split("@")[0],
					});
					if (result.error) {
						setError(
							String(
								result.error.message || translate("pageAuthLoginRegisterError"),
							),
						);
						return;
					}
				} else {
					const result = await signIn.email({ email, password });
					if (result.error) {
						setError(
							String(
								result.error.message ||
									translate("pageAuthLoginInvalidCredentials"),
							),
						);
						return;
					}
				}

				U.Router.go("/auth/better-account", { replace: true });
			} catch (err) {
				setError(thrownMessage(err, translate("pageAuthLoginUnknownError")));
			} finally {
				submitRef.current?.setLoading(false);
			}
		};

		const toggleMode = () => {
			setIsRegister(!isRegister);
			setError("");
		};

		return (
			<div ref={nodeRef}>
				<Header {...props} component="authIndex" />

				<Frame>
					<div className="intro animation">
						<Label
							className="line1"
							text={
								isRegister
									? translate("authRegisterTitle")
									: translate("authLoginTitle")
							}
						/>
						<Label
							className="line2"
							text={
								isRegister
									? translate("authRegisterSubtitle")
									: translate("authLoginSubtitle")
							}
						/>
					</div>

					<form onSubmit={onSubmit} className="authForm">
						{isRegister && (
							<div className="input animation">
								<Label text={translate("authName")} />
								<Input
									value={name}
									onChange={(e, v) => setName(v)}
									placeholder={translate("authNamePlaceholder")}
									maxLength={100}
								/>
							</div>
						)}

						<div className="input animation">
							<Label text={translate("authEmail")} />
							<Input
								ref={emailRef}
								type="email"
								placeholder={translate("authEmailPlaceholder")}
								autoComplete="email"
							/>
						</div>

						<div className="input animation">
							<Label text={translate("authPassword")} />
							<Input
								ref={passwordRef}
								type="password"
								placeholder={translate("authPasswordPlaceholder")}
								autoComplete={isRegister ? "new-password" : "current-password"}
							/>
						</div>

						<Error text={error} />

						<div className="buttons animation">
							<Button
								ref={submitRef}
								text={
									isRegister
										? translate("authRegister")
										: translate("authLogin")
								}
								color="accent"
								size={48}
								onClick={onSubmit}
							/>
							<Button
								text={
									isRegister
										? translate("authHaveAccount")
										: translate("authNoAccount")
								}
								color="blank"
								size={48}
								onClick={toggleMode}
							/>
						</div>
					</form>
				</Frame>

				<Footer {...props} className="animation" component="authDisclaimer" />
			</div>
		);
	},
);

export default PageAuthBetterLogin;
