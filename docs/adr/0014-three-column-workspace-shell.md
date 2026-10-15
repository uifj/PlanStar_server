# 0014. The workspace lives in a three-column shell

Status: accepted
Date: 2026-10-15

## Context

`front_web` still wore the VanLife client's chrome: a centred `Header` with the role
navigation, language and theme controls, and a `Footer` under one wide column. That shape
has no place to put a space, its types, or the object currently being read, and the object
workspace added in phase 6 sat behind `import.meta.env.DEV`, so nothing a visitor could
reach showed the kernel. The reference app keeps a fixed-width navigation column open all
the time, puts the object's own values and incoming links in a second column when one is
focused, and gives the rest of the width to the page.

## Decision

`RootLayout` is a three-column shell on every production route. The left 240px column is
the single navigation landmark: brand, the role navigation `getHeaderNavigation` already
builds, the caller's spaces from `GET /spaces` with the open space's types nested under it,
and the language, theme and account controls at the bottom. The middle column is the page
plus the footer. The right column is 336px, exists only while `?focus=<objectId>` is in the
address bar, and reads the object detail and `GET /objects/:id/backlinks` together. The
space browser moves to `/space` and is no longer dev-gated; the object and block demo pages
stay behind the dev flag.

## Consequences

One `navigation` landmark per page means the rail renders its own links rather than
reusing the shared `Nav`, which the host area still uses. Space switching lives only in the
rail, so the browser's own space column was deleted and `?spaceId=` became the sole carrier
of which space is open - every deep link has to name it. Focus is URL state, so a palette
jump and a row click converge on the same panel and a link can be shared with it open. The
shell calls `GET /spaces` on every page, including sign-in and the marketing pages, which
answer an empty space section to a guest rather than an error. A guest's navigation is the
two links `getHeaderNavigation` already returns, so the shell is not an authenticated-only
surface; nothing about the header's removal changes what those pages render.
