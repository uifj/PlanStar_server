# 0016. Text size follows the role, on Anytype's scale

Status: superseded-by-0017 for the historical custom UI implementation; design intent retained
Date: 2026-10-15

## Context

The workspace had grown screen by screen on Tailwind's default type scale, with control
text written as `text-xs` wherever a component wanted to look compact. Measured against
`_archvie/anytype-ts-develop`, the result read as one flat grey mass: table values,
buttons, captions and headers all landed between 11px and 14px with no rule deciding
which, and the body itself inherited the browser's 16px. Anytype is not vaguer - it is
stricter: a fixed eight-tier scale, and each tier assigned by what the text *is*.

## Decision

`front_web/src/style.css` redefines Tailwind's text utilities as Anytype's tiers, values
taken from the reference's `_vars.scss`: `xs` 11/18, `sm` 12/18, `base` 14/22, `lg` 16/24,
`xl` 18/26, `2xl` 22/28, `3xl` 28/32, `4xl` 36/40, each with the reference's letter-spacing.
Only text moves - spacing, sizing and radii keep Tailwind's steps - so the interface gets
denser without appearing zoomed out. `body` is set to `base`, which makes 14px/22px the
default for anything that does not say otherwise.

Which tier a piece of text uses is decided by its role, not by how much room it has:

- **Values** - table cells, property rows, relation pickers, inputs - are `base` (14px).
  This is Anytype's `text-common`, which is what its dataview block and its filter chips
  use for content.
- **Headers and secondary lines** - the grid's column row, card meta, counts - are `sm`
  (12px), Anytype's `cellHead` and `text-small`.
- **Captions** - the rail's section label, a block's style tag, a drag handle - are `xs`
  (11px), the reference's `very-small`, and are uppercase as it writes them.
- **Controls take the size of the box they are in**: a 32px control carries 12px, a 36px
  one carries 14px, which is Anytype's `size32`/`size36` pair. The button primitive used to
  force `text-xs` onto its small size, so 11px spread through every compact action; it now
  inherits from `body` unless a size says otherwise.
- **View tabs** are `xl` (18px) at weight 700, because Anytype's `.viewItem` is
  `text-header3`, not button text.

## Consequences

This is a theme-layer change, so nothing about it is covered by a test: it was verified by
reading `getComputedStyle` off the running app (body 14/22, rail rows 32px/14px, tabs
18px/700, selects 32px/14px, cells 14px, headers 12px). Because `sm`/`xs` got smaller and
`base` got the body default, every legacy page moved too - the user chose that scope over
limiting it to the workspace, so `PageHeader`'s title now sits on the 36px title tier.

Two gaps remain visible and are deliberately not closed here. Grid rows measure 41px where
Anytype's are 48px, and its header row 36px where ours is 52.5px; row height is layout, not
type, and was declined alongside the calendar, board and gallery geometry. Legacy headings
still ask for `font-black` (900) where Anytype writes 700. Adding a new text utility will
not pick up an Anytype value unless it is named here, and `--text-5xl` is still Tailwind's
default - use `4xl` for a title.

## Amendment, 2026-10-16 — historical Tailwind mapping, retained visual intent

The `style.css` overrides, utility mapping, measurements and remaining geometry gaps
above describe the replaced custom frontend, not verified properties of today's client.
[0017](0017-hono-rpc-web-client.md) keeps the current Anytype SCSS shell and its role-based
typography. The distinction between values, secondary text, captions, controls and view
tabs remains design intent; do not reintroduce the old Tailwind theme to implement it.
New auth and Tiptap surfaces must fit the existing style rather than trigger a UI redesign.
Their integration and visual acceptance remain pending; the historical computed-style
check does not validate the replacement editor or the full migration.
