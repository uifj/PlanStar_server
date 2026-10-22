import type { Decorator } from "@storybook/react";
import React from "react";

/**
 * The real renderer adds platform classes to `<html>` while booting (`keyboard.setBodyClass`).
 * CSS in `legacy.css` keys macOS layout rules off `.platformMac`, so stories that show window chrome
 * look wrong without it. The desktop shell this tree targets is macOS, which is what the vendored
 * stories were written against.
 */
export const withAppClass: Decorator = (Story) => {
	React.useEffect(() => {
		const html = document.documentElement;
		html.classList.add("platformMac");

		return () => {
			html.classList.remove("platformMac");
		};
	}, []);

	return <Story />;
};

/**
 * Wraps stories in a container with standard padding. Width and padding come from
 * `parameters.container`.
 */
export const withContainer: Decorator = (Story, context) => {
	const { width, padding } = context.parameters.container || {};

	return (
		<div style={{ width: width || "auto", padding: padding ?? 16 }}>
			<Story />
		</div>
	);
};

/**
 * Paints the background declared in `parameters.background`.
 */
export const withBackground: Decorator = (Story, context) => {
	const bg = context.parameters.background || "transparent";

	return (
		<div style={{ background: bg, padding: 16, borderRadius: 8 }}>
			<Story />
		</div>
	);
};

/**
 * Popup DOM: `.popups > .popup.popup{Name}.show > .innerWrap > .content`.
 */
export const withPopup = (popupId: string, className?: string): Decorator => {
	return (Story) => {
		const classNames = ["popup", `popup${popupId}`, "show"];
		if (className) {
			classNames.push(className);
		}

		return (
			<div className="popups">
				<div
					className={classNames.join(" ")}
					style={{ position: "relative", width: "100%", height: "100%" }}
				>
					<div
						className="innerWrap"
						style={{ position: "relative", opacity: 1, transform: "none" }}
					>
						<div className="content">
							<Story />
						</div>
					</div>
				</div>
			</div>
		);
	};
};

/**
 * Menu DOM: `.menus > .menuWrap > .menu.vertical.show > .content > .items`. An optional class can
 * be added to the `.menu` element (for example `menuBlockStyle`).
 */
export const withMenuClass = (menuClass?: string): Decorator => {
	return (Story) => (
		<div className="menus">
			<div className="menuWrap" style={{ position: "relative" }}>
				<div
					className={`menu vertical ${menuClass || ""} show`.trim()}
					style={{
						position: "relative",
						opacity: 1,
						transform: "none",
						boxShadow: "none",
						width: 280,
					}}
				>
					<div className="content">
						<div className="items">
							<Story />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};

export const withMenu: Decorator = withMenuClass();

/**
 * Block DOM: `.blocks > .block.{blockClass}.align0 > .wrapContent`.
 */
export const withBlock = (blockClass: string): Decorator => {
	return (Story) => (
		<div className="blocks" style={{ padding: 16, maxWidth: 700 }}>
			<div className={`block ${blockClass} align0`}>
				<div className="wrapMenu" />
				<div className="wrapContent">
					<Story />
				</div>
			</div>
		</div>
	);
};

/**
 * Header DOM: `.header.{component}.isCommon`.
 */
export const withHeader = (component: string): Decorator => {
	return (Story) => {
		const classNames = ["header", component, "isCommon"];

		return (
			<div
				className={classNames.join(" ")}
				style={{ position: "relative", width: "100%" }}
			>
				<Story />
			</div>
		);
	};
};

/**
 * Horizontal toolbar DOM: `.menus > .menuWrap > .menu.horizontal.{menuClass}.show > .content`.
 */
export const withHorizontalMenu = (menuClass: string): Decorator => {
	return (Story) => (
		<div className="menus">
			<div className="menuWrap" style={{ position: "relative" }}>
				<div
					className={`menu horizontal ${menuClass} show`}
					style={{ position: "relative", opacity: 1, transform: "none" }}
				>
					<div className="content">
						<Story />
					</div>
				</div>
			</div>
		</div>
	);
};

/**
 * Notification DOM: `.notifications`.
 */
export const withNotification: Decorator = (Story) => (
	<div
		className="notifications"
		style={{ position: "relative", right: "auto", bottom: "auto" }}
	>
		<Story />
	</div>
);

/**
 * Widget DOM: `.widget.{widgetClass} > .contentWrapper`.
 */
export const withWidget = (widgetClass: string): Decorator => {
	return (Story) => (
		<div
			className={`widget ${widgetClass}`}
			style={{
				background: "var(--color-shape-highlight-light)",
				borderRadius: 12,
			}}
		>
			<div className="contentWrapper">
				<Story />
			</div>
		</div>
	);
};

/**
 * Widget view DOM: `.widget.widgetView > .contentWrapper > .{viewClass} > .body > .items`.
 * `bodyClass` adds an optional modifier such as `isCompact`.
 */
export const withWidgetView = (
	viewClass: string,
	bodyClass?: string,
): Decorator => {
	return (Story) => {
		const bodyClassNames = ["body"];
		if (bodyClass) {
			bodyClassNames.push(bodyClass);
		}

		return (
			<div
				className="widget widgetView"
				style={{
					background: "var(--color-shape-highlight-light)",
					borderRadius: 12,
				}}
			>
				<div className="contentWrapper">
					<div className={viewClass}>
						<div className={bodyClassNames.join(" ")}>
							<div className="items">
								<Story />
							</div>
						</div>
					</div>
				</div>
			</div>
		);
	};
};
