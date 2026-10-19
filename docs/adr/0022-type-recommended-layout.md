# 0022. A type's recommended layout is inherited at create and reset on demand

Status: accepted
Date: 2026-10-19
Amends: [0013](0013-documents-are-ordered-blocks.md) — layout is a property of the object row, not of
its body, so a body model does not settle which layout an object should have.

## Context

The client's type sidebar writes `recommendedLayout` through `ObjectListSetDetails`
(`front_web/src/ts/component/sidebar/section/type/layout.tsx:36` → `sidebar/page/type.tsx:175`), and the
type page offers "Reset to match the Type" (`component/page/elements/head/simple.tsx:248`), whose own
copy says it resets "layout type, alignment, and featured properties for all objects of this type".
Before this decision, the recommendation was persisted and then ignored: `ObjectCreate` stamped every
object `basic`, so a Task type produced pages, and `ObjectTypeResolveLayoutConflicts` had no answer at
all — and because the shell dispatches it without a callback, the user saw a confirm dialog close over
an unchanged space.

Two constraints shaped the options:

* `Obj.resolvedLayout` is a Prisma enum, and its members were exactly the layouts this server's own
  creation paths produce. The layouts the sidebar offers — Human (1), Task (2), Note (9) — could not
  be stored at all.
* A recommendation cannot promote an object into a list layout. Set and Collection need a source or a
  membership; turning a page into one silently would invent a query.

## Decision

Treat the recommendation as a real default, for the layouts that are genuinely a default of a single
object:

1. `ObjectLayout` gains `human`, `task` and `note`. `Page` stays the existing `basic` member.
2. `ObjectCreate` inherits: an object created with a type takes that type's recommended layout, so new
   tasks come from a Task type without any repair step.
3. `ObjectTypeResolveLayoutConflicts` performs the layout half of what the menu promises: it rewrites
   every live object of the type that does not already carry the recommendation, writer-gated on the
   type's space, and re-evaluates the space's subscriptions so open lists update without a reload. It
   answers NOT_FOUND for a missing type and NOT_SUPPORTED for an id that is not a type.

Alignment and featured relations are **not** reset. Alignment in this build lives in the Yjs body
(per-paragraph text-align), not in object details, so there is no per-object alignment to restore;
featured relations are per-object state with no type-side default to copy. Doing "layout only" and
saying so is better than writing a partial reset that the copy over-promises.

List layouts (`set`, `collection`) are deliberately outside the inheritance table: an unmappable
recommendation is ignored, not guessed at.

## Consequences

* The `basic` member means "Page" in this schema, and the details `layout` marker is only a fallback
  for rows whose column can assert nothing (`numericLayout`, `src/modules/command/registry-service.ts`).
  A layout the type asserts wins over the marker.
* `docs/frontend-capabilities.json`'s `LISTABLE_OBJECT_LAYOUTS` still lists only `basic`, so task/note/
  human objects are absent from the superseded REST list route — consistent with how it already treats
  set, file and bookmark rows.
* The reset is not retroactive on its own: changing a recommendation leaves existing objects alone
  until the user asks for the reset, which is what the confirm dialog is for.
