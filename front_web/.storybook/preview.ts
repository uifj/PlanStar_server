import "./globals";
import type { Preview } from "@storybook/react";
import "../src/styles/legacy.css";
import "./storybook.css";
import { withAppClass } from "./decorators";

/**
 * `globals` installs the browser Electron mock before any story module is evaluated, mirroring
 * `src/ts/entry.web.tsx`. Components read `window.Electron` through `U.Common.getElectron()`.
 */
const preview: Preview = {
	decorators: [withAppClass],
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /date$/i,
			},
		},
	},
};

export default preview;
