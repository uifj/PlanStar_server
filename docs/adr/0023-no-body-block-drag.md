# 0023. The document body has no block drag-and-drop

Status: accepted
Date: 2026-10-19
Amends: [0013](0013-documents-are-ordered-blocks.md) — ordered blocks stay the storage model; this
decision only removes one way of *reordering* them from the web editor.

## Context

The body editor grew a second drag implementation. `component/editor/dragHandle.ts` installed
`@tiptap/extension-drag-handle` + `@tiptap/extension-node-range`, floating a `⠿` grip beside the
hovered block and reordering it with a ProseMirror transaction. Meanwhile the shell already owns
dragging: `component/drag/provider.tsx` implements Anytype's own pointer/drag pipeline, which is what
drags files onto a page (`FileDrop`), objects onto a collection, and rows within the vault, widgets
and dataview views (those use `@dnd-kit`).

Two content-drag systems in one page is not two features but one ambiguity: which grip moves which
block, and what happens when a shell drag lands on a Tiptap block that ProseMirror is simultaneously
reordering. The Tiptap side also cannot express Anytype's block semantics — it moves the editor node
inside one document, while the shell's model moves a block between store rows.

## Decision

Remove the Tiptap-side content drag: `dragHandle.ts` and its test are deleted,
`createCollabExtensions` no longer installs `DragHandle`/`NodeRange`, and the `.dragHandle` grip styles
come out of `collabBody.scss`. Block reordering in the web body is not offered.

`@dnd-kit` stays: it is the shell's reordering mechanism for views, widgets and the vault — not the
document body. If body reordering is ever wanted, it goes through the shell's own drag pipeline so
that one gesture means one thing, not through a second editor-level handle.

## Consequences

* The grip is gone from the DOM (verified live: 0 `.dragHandle` nodes, including on hover), so the body
  has one drag vocabulary — the shell's.
* Two `@tiptap` packages are now unreferenced (`extension-drag-handle`, `extension-node-range`). They
  are left in `front_web/package.json` until the dependency removal is confirmed separately, because
  an install touches the lockfile and `node_modules` of a vendored tree.
* Finding this exposed a worse defect that the grip had been hiding: `CollabBody` passed
  `editable: !readonly` into `useEditor`, whose dependency list is the provider, so the verdict was
  taken once at mount — and on a cold load the object view has not reached the store yet, so every
  reloaded or deep-linked page rendered read-only (and showed a second placeholder from the shell's
  virtual block, which is the screenshot that prompted this). `collabBody.tsx` now syncs
  `editor.setEditable(!readonly)` when `readonly` changes.
