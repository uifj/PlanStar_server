import ErrorMessage from "@/shared/components/ErrorMessage";

type GuardStatus = "checking" | "failed" | "signingOut";

export function getAuthGuardState(status: GuardStatus | string) {
	if (status === "checking" || status === "signingOut") {
		return null;
	}

	if (status === "failed") {
		return <ErrorMessage />;
	}

	return undefined;
}
