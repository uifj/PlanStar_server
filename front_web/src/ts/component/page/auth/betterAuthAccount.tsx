import { Button, Footer, Frame, Header, Label } from "Component";
import type * as I from "Interface";
import { signOut, useSession } from "Lib/api/better-auth";
import { ensureBootstrapSpace, type Space } from "Lib/api/spaces";
import React, { forwardRef, useEffect, useRef, useState } from "react";

// Authenticated entrance for the web build. The boot gate routes here once a
// Better Auth session is restored; later phases grow this into the workspace
// (spaces, then the collaborative document).
const PageAuthBetterAccount = forwardRef<I.PageRef, I.PageComponent>(
	(props, ref) => {
		const nodeRef = useRef(null);
		const signOutRef = useRef(null);
		const { data: session, isPending } = useSession();

		const [spaces, setSpaces] = useState<Space[]>([]);
		const [spaceError, setSpaceError] = useState("");

		// Bootstrap the real account: the web build has no mnemonic chain, so the
		// first Hono-backed space is provisioned here once the session is known.
		useEffect(() => {
			let active = true;

			ensureBootstrapSpace()
				.then((result) => {
					if (active) {
						setSpaces(result);
					}
				})
				.catch((err: unknown) => {
					if (!active) {
						return;
					}

					const message =
						err && typeof err === "object" && "message" in err
							? String((err as { message?: unknown }).message)
							: "";
					setSpaceError(message || translate("authAccountSpaceError"));
				});

			return () => {
				active = false;
			};
		}, []);

		const onSignOut = async () => {
			signOutRef.current?.setLoading(true);

			try {
				await signOut();
				U.Router.go("/auth/better-login", { replace: true });
			} finally {
				signOutRef.current?.setLoading(false);
			}
		};

		const user = session?.user;
		const identity = user?.name || user?.email || "";

		const space = spaces[0];
		const spaceText = spaceError
			? spaceError
			: space
				? `${translate("authAccountSpace")}: ${space.name}`
				: translate("authAccountSpaceLoading");

		return (
			<div ref={nodeRef}>
				<Header {...props} component="authIndex" />

				<Frame>
					<div className="intro animation">
						<Label className="line1" text={translate("authAccountTitle")} />
						<Label
							className="line2"
							text={
								isPending
									? translate("authAccountLoading")
									: identity || translate("authAccountEmpty")
							}
						/>
						<Label className="line3" text={spaceText} />
					</div>

					<div className="buttons animation">
						<Button
							ref={signOutRef}
							text={translate("authSignOut")}
							color="accent"
							size={48}
							onClick={onSignOut}
						/>
					</div>
				</Frame>

				<Footer {...props} className="animation" component="authDisclaimer" />
			</div>
		);
	},
);

export default PageAuthBetterAccount;
