export const spacesRoutePaths = {
	browser: "space",
	object: "object",
} as const;

// The shell's rail and the page share these, so a space is reachable from one place.
export function spaceBrowserLink(spaceId: string) {
	return `/${spacesRoutePaths.browser}?spaceId=${spaceId}`;
}

export function spaceTypeLink(spaceId: string, typeId: string) {
	return `${spaceBrowserLink(spaceId)}&typeId=${typeId}`;
}

// An object page carries its space so the rail still marks the open space.
export function objectLink(objectId: string, spaceId: string) {
	return `/${spacesRoutePaths.object}/${objectId}?spaceId=${spaceId}`;
}
