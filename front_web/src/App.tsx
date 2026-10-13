import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router";
import { AppRoutes } from "./app/routes/AppRoutes";
import { AuthProvider } from "./modules/auth/context/AuthProvider";
import { LangProvider } from "./shared/i18n";
import { ThemeProvider } from "./shared/theme";

const queryClient = new QueryClient();

function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<ThemeProvider>
					<LangProvider>
						<AuthProvider>
							<AppRoutes />
						</AuthProvider>
					</LangProvider>
				</ThemeProvider>
			</BrowserRouter>
		</QueryClientProvider>
	);
}

export default App;
