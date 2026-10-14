import { Outlet } from "react-router";
import { Toaster } from "sonner";
import { useTheme } from "@/shared/theme";
import Footer from "./Footer";
import Header from "./Header";

export default function RootLayout() {
	const { theme } = useTheme();

	return (
		<div className="flex min-h-dvh flex-col bg-background text-foreground">
			<Header />

			<main className="flex-1">
				<Outlet />
			</main>

			<Footer />

			<Toaster position="bottom-right" theme={theme} />
		</div>
	);
}
