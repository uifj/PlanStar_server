// Global variables injected by rspack DefinePlugin
// These always have values - either from env vars or defaults
declare const SPARK_ONBOARDING_URL: string;
declare const SPARK_ONBOARDING_TOKEN: string;
declare const SPARK_ONBOARDING_NO_AUTH: string;
declare const SENTRY_DSN: string;
declare const IMPORT_AI_ANYTYPE_ENDPOINT: string;
declare const IMPORT_AI_ANYTYPE_MODEL: string;
declare const IMPORT_AI_ANYTYPE_TOKEN: string;
declare const __IS_EXTENSION__: string;

declare module "selection-ranges";

// `katex` has no `.d.ts` for this side-effect-only entry and its `exports` map does not expose the
// subpath, so `moduleResolution: "Bundler"` needs the module declared explicitly.
declare module "katex/dist/contrib/mhchem";

// @tailwindcss/vite ships only dist/index.d.mts, which the renderer's `moduleResolution: "Node"`
// cannot read. vite.web.config.ts is pulled into this program by webBuildDefines.test.ts, so the
// import needs a shape to resolve against. Mirrors the package's declared signature.
declare module "@tailwindcss/vite" {
	import type { Plugin } from "vite";

	export type PluginOptions = {
		optimize?: boolean | { minify?: boolean };
	};

	export default function tailwindcss(opts?: PluginOptions): Plugin[];
}
