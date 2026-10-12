import { Outlet } from "react-router";
import Footer from "./Footer";
import Header from "./Header";

export default function RootLayout() {
	return (
		<div className="flex min-h-dvh flex-col bg-canvas text-ink">
			<Header />

			<main className="flex-1">
				<Outlet />
			</main>

			<Footer />
		</div>
	);
}
