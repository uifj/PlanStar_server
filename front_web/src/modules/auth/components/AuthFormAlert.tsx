import { Alert } from "@/shared/components/Alert";

interface AuthFormAlertProps {
	message?: string;
	variant?: "error" | "info";
}

export function AuthFormAlert({
	message,
	variant = "info",
}: AuthFormAlertProps) {
	if (!message) {
		return null;
	}

	return <Alert variant={variant}>{message}</Alert>;
}
