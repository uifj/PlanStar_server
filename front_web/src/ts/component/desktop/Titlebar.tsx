import { desktop } from "Lib/desktop";
import {
	type DesktopCommandId,
	DesktopCommandIds,
} from "@harness/desktop-shared";
// biome-ignore lint/style/useImportType: tsconfig keeps the classic JSX transform (jsx: "react"), where React must stay a value import.
import React from "react";

/**
 * Desktop titlebar band, modelled on ZCode's `h-12 shrink-0 [app-region:drag]` strip
 * (packages/ui/src/settings/AutomationsMainBreadcrumbFrame.tsx).
 *
 * It is a real flex child of #appContainer (display:flex; flex-direction:column), not a fixed
 * overlay: the band occupies layout height, so #selection and everything inside it start below
 * the band and no content can slide underneath the macOS traffic lights. That is the whole point
 * of the ZCode layout — the titlebar is a sibling, not a floating layer.
 *
 * Left to right:
 *   - an 88px spacer so the native traffic lights (positioned in main.ts) never overlap UI;
 *   - a flexible drag region that moves the window;
 *   - window tools marked no-drag so their clicks are not swallowed by the drag region.
 *
 * Colours come from the Tailwind token bridge in src/styles/desktop.css (bg-surface, text-fg-subtle,
 * …) which resolves to the live anytype palette, so the light/dark theme keeps working. Height comes
 * from --desktop-titlebar-h, the same token the frozen offset rules in legacy.css read. Responsive:
 * the tools collapse on narrow windows (ZCode's sm: breakpoint), leaving a clean drag strip; the whole
 * band disappears in native fullscreen (fullscreen: variant), where macOS reclaims the titlebar area
 * and legacy.css (formerly scss/desktop/titlebar.scss) also drops its sidebar offset.
 *
 * This is the first migrated surface: styled only with Tailwind utilities (no legacy stylesheet).
 */
const appRegion = (value: "drag" | "no-drag") =>
	({ WebkitAppRegion: value }) as React.CSSProperties;

const run = (id: DesktopCommandId) => {
	void desktop.executeCommand(id);
};

const ToolButton = ({
	id,
	label,
	children,
}: {
	id: DesktopCommandId;
	label: string;
	children: React.ReactNode;
}) => (
	<button
		type="button"
		aria-label={label}
		title={label}
		onClick={() => run(id)}
		className="flex h-8 w-8 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-muted hover:text-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg-faint"
	>
		{children}
	</button>
);

const IconMinus = () => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
	>
		<path d="M3.5 8h9" />
	</svg>
);

const IconPlus = () => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
	>
		<path d="M8 3.5v9M3.5 8h9" />
	</svg>
);

const IconReset = () => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M3 8a5 5 0 1 0 1.5-3.6" />
		<path d="M3 3v2.5h2.5" />
	</svg>
);

const IconExpand = () => (
	<svg
		width="16"
		height="16"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		strokeWidth="1.5"
		strokeLinecap="round"
		strokeLinejoin="round"
	>
		<path d="M6 3H3v3M10 3h3v3M10 13h3v-3M6 13H3v-3" />
	</svg>
);

export const DesktopTitlebar = () => (
	<header
		id="desktopTitlebar"
		// Inline style rather than Tailwind's [app-region:drag]: -webkit-app-region is the property
		// Chromium actually honours, and React only lets it through as a style entry.
		style={appRegion("drag")}
		className="relative z-30 flex fullscreen:hidden h-[var(--desktop-titlebar-h)] shrink-0 select-none items-center bg-surface"
	>
		{/* macOS traffic lights live in this zone; main.ts positions them inside the band. */}
		<div className="w-[88px] shrink-0" aria-hidden="true" />

		<div className="h-full flex-1" aria-hidden="true" />

		<div
			style={appRegion("no-drag")}
			className="hidden h-full shrink-0 items-center gap-1 pr-2 sm:flex"
		>
			<ToolButton id={DesktopCommandIds.ZoomOut} label="Zoom out">
				<IconMinus />
			</ToolButton>
			<ToolButton id={DesktopCommandIds.ResetZoom} label="Reset zoom">
				<IconReset />
			</ToolButton>
			<ToolButton id={DesktopCommandIds.ZoomIn} label="Zoom in">
				<IconPlus />
			</ToolButton>
			<ToolButton
				id={DesktopCommandIds.ToggleFullScreen}
				label="Toggle full screen"
			>
				<IconExpand />
			</ToolButton>
		</div>
	</header>
);
