import fs from "node:fs";
import path from "node:path";
import type { StorybookConfig } from "@storybook/react-vite";
import AutoImport from "unplugin-auto-import/vite";

/**
 * The gallery stories are vendored from the Anytype client tree, which used Storybook 8. Storybook 10
 * only loads ESM presets, so this file uses `import.meta.dirname` instead of `__dirname`.
 *
 * The aliases and auto-imports below mirror `vite.web.config.ts` on purpose: the stories resolve the
 * same `Store` / `Lib` / `json` specifiers as the renderer, and components rely on the injected `S`,
 * `U`, `J` etc. namespaces. `vite.web.config.ts` itself is not loaded because its SPA fallback and
 * upload middleware would answer Storybook's own `/iframe.html` and `/index.json` requests.
 */

const projectRoot = path.resolve(import.meta.dirname, "..");
const srcImgDir = path.resolve(projectRoot, "src/img");
const distImgDir = path.resolve(projectRoot, "dist/img");

const config: StorybookConfig = {
	stories: ["../src/**/*.stories.tsx"],
	addons: ["@storybook/addon-docs"],
	framework: {
		name: "@storybook/react-vite",
		options: {},
	},
	core: {
		disableTelemetry: true,
	},
	viteFinal: async (viteConfig) => {
		viteConfig.resolve = viteConfig.resolve || {};
		viteConfig.resolve.extensions = [".ts", ".tsx", ".js", ".jsx", ".json"];
		viteConfig.resolve.alias = [
			{
				find: "SbHelpers",
				replacement: path.resolve(import.meta.dirname, "helpers"),
			},
			{ find: "dist", replacement: path.resolve(projectRoot, "dist") },
			{ find: "protobuf", replacement: path.resolve(projectRoot, "dist/lib") },
			{ find: "json", replacement: path.resolve(projectRoot, "src/json") },
			{ find: "Lib", replacement: path.resolve(projectRoot, "src/ts/lib") },
			{ find: "Store", replacement: path.resolve(projectRoot, "src/ts/store") },
			{
				find: "Component",
				replacement: path.resolve(projectRoot, "src/ts/component"),
			},
			{
				find: "Interface",
				replacement: path.resolve(projectRoot, "src/ts/interface"),
			},
			{ find: "Model", replacement: path.resolve(projectRoot, "src/ts/model") },
			{ find: "Docs", replacement: path.resolve(projectRoot, "src/ts/docs") },
			{ find: "Hook", replacement: path.resolve(projectRoot, "src/ts/hook") },
			{ find: "img", replacement: path.resolve(projectRoot, "src/img") },
			{ find: "css", replacement: path.resolve(projectRoot, "dist/css") },
			{ find: "Proto", replacement: path.resolve(projectRoot, "middleware") },
			{
				find: "mermaid",
				replacement: path.resolve(
					projectRoot,
					"node_modules/mermaid/dist/mermaid.esm.mjs",
				),
			},
			// ~img/ URLs: prefer the source asset and fall back to the prebuilt one, as the app does.
			{
				find: /^~img\//,
				replacement: "",
				customResolver(source: string) {
					const srcPath = path.join(srcImgDir, source);
					if (fs.existsSync(srcPath)) {
						return srcPath;
					}

					const distPath = path.join(distImgDir, source);
					if (fs.existsSync(distPath)) {
						return distPath;
					}

					return srcPath;
				},
			},
			{ find: "~font", replacement: path.resolve(projectRoot, "dist/font") },
			{ find: "~css", replacement: path.resolve(projectRoot, "dist/css") },
		];

		viteConfig.define = {
			...viteConfig.define,
			__IS_WEB__: "true",
			SENTRY_DSN: JSON.stringify(process.env.SENTRY_DSN || ""),
			SPARK_ONBOARDING_URL: JSON.stringify(
				process.env.SPARK_ONBOARDING_URL || "",
			),
			SPARK_ONBOARDING_TOKEN: JSON.stringify(
				process.env.SPARK_ONBOARDING_TOKEN || "",
			),
			SPARK_ONBOARDING_NO_AUTH: JSON.stringify(
				process.env.SPARK_ONBOARDING_NO_AUTH || "false",
			),
			IMPORT_AI_ANYTYPE_ENDPOINT: JSON.stringify(
				process.env.IMPORT_AI_ANYTYPE_ENDPOINT || "",
			),
			IMPORT_AI_ANYTYPE_MODEL: JSON.stringify(
				process.env.IMPORT_AI_ANYTYPE_MODEL || "",
			),
			IMPORT_AI_ANYTYPE_TOKEN: JSON.stringify(
				process.env.IMPORT_AI_ANYTYPE_TOKEN || "",
			),
		};

		viteConfig.plugins = viteConfig.plugins || [];
		viteConfig.plugins.push(
			AutoImport({
				imports: [
					{
						Store: [["*", "S"]],
						Hook: [["*", "H"]],
						json: [["*", "J"]],
					},
					{
						"Lib/api/command": [["*", "C"]],
						"Lib/util": [["*", "U"]],
						"Lib/keyboard": [
							["keyboard", "keyboard"],
							["Key", "Key"],
						],
						"Lib/sidebar": [["sidebar", "sidebar"]],
						"Lib/mark": [["default", "Mark"]],
						"Lib/relation": [["default", "Relation"]],
						"Lib/dataview": [["default", "Dataview"]],
						"Lib/scrollOnMove": [["scrollOnMove", "scrollOnMove"]],
						"Lib/analytics": [["analytics", "analytics"]],
						"Lib/action": [["default", "Action"]],
						"Lib/onboarding": [["default", "Onboarding"]],
						"Lib/survey": [["default", "Survey"]],
						"Lib/preview": [["default", "Preview"]],
						"Lib/translate": [["translate", "translate"]],
						"Lib/sound": [
							["default", "Sound"],
							["SYSTEM_SOUND_ID", "SYSTEM_SOUND_ID"],
						],
						"Lib/renderer": [["default", "Renderer"]],
						"Lib/api/dispatcher": [["dispatcher", "dispatcher"]],
						"Lib/api/mapper": [["Mapper", "Mapper"]],
						"Lib/api/struct": [
							["Encode", "Encode"],
							["Decode", "Decode"],
						],
						"Lib/service/sparkOnboarding": [
							["getSparkOnboardingService", "getSparkOnboardingService"],
						],
					},
				],
				dts: false,
				include: [/\.tsx?$/],
				exclude: [
					/node_modules/,
					/src\/ts\/lib\/index\.ts$/,
					/src\/ts\/store\/index\.ts$/,
					/src\/ts\/interface\/index\.ts$/,
					/src\/ts\/model\/index\.ts$/,
					/src\/ts\/component\/index\.ts$/,
				],
			}),
		);

		return viteConfig;
	},
};

export default config;
