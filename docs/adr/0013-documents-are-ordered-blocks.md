# 0013. Documents are ordered blocks

Status: accepted
Date: 2026-10-14

## Context

A page in Anytype is a block tree: every block carries a type, type-specific content, a
parent and an ordered list of children, and that child order comes from CRDT ids minted
by the Go middleware. This server has no CRDT layer, and ADR-0003 already committed to
fractional string indexes with last-write-wins for every ordered list, naming
`Block.index` as one of them. The object that owns a document is the page object, i.e.
`resolvedLayout = basic`, so blocks hang off something that already exists.

## Decision

A `Block` table holds one row per block: `objectId` to the owning page with cascade,
`type` restricted to `text` and `link` for this phase, `style` for the paragraph, heading,
quote, code, bulleted, numbered and toggle variants, `text`, an optional `linkTargetId`, a
self-referencing `parentId` and a required fractional `index`. Reads return a **flat list
ordered by index, carrying parentId**, and each client assembles the tree. Clients never
send an index: they position relative to a sibling with `afterBlockId` and the server
mints the value between its neighbours. A `link` block additionally writes a `Link` row
under the reserved relation key `links`, so a page joins the graph and the backlink read
from phase 2 serves documents with no new query path; the edge is deleted only when no
other link block in the same page points at that target.

## Consequences

Rich text marks, files, images, embeds and tables are not modelled, so a page is a
sequence of plain strings and links rather than a full document; adding them later is new
enum values and new columns, not a reshape. Ordering stays last-write-wins, so two clients
dragging the same page can mint the same index between the same neighbours and the later
write simply wins — the same exposure ADR-0003 already accepted, now on a surface where
it is easier to hit. Flat reads push tree assembly into every client, but keep a document
read to one ordered query and make a move one PATCH for the moved block instead of
renumbering its siblings. Blocks on registry mirrors and saved views are rejected rather
than unmodelled, because a type or a view has no body to edit.
