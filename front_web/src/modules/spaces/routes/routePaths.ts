export const spacesRoutePaths = {
	browser: "space",
} as const;

// The shell's rail and the page share these, so a space is reachable from one place.
export function spaceBrowserLink(spaceId: string) {
	return `/${spacesRoutePaths.browser}?spaceId=${spaceId}`;
}

export function spaceTypeLink(spaceId: string, typeId: string) {
	return `${spaceBrowserLink(spaceId)}&typeId=${typeId}`;
}
