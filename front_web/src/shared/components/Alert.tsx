import { CircleAlert, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { AlertDescription, Alert as ShadcnAlert } from "@/components/ui/alert";

interface AlertProps {
	variant?: "info" | "error";
	children: ReactNode;
}

export function Alert({ variant = "info", children }: AlertProps) {
	const destructive = variant === "error";
	const Icon = destructive ? TriangleAlert : CircleAlert;

	return (
		<ShadcnAlert
			variant={destructive ? "destructive" : "default"}
			role={destructive ? "alert" : "status"}
			aria-live={destructive ? "assertive" : "polite"}
		>
			<Icon aria-hidden="true" className="size-4" />
			<AlertDescription className="font-medium leading-6">
				{children}
			</AlertDescription>
		</ShadcnAlert>
	);
}
