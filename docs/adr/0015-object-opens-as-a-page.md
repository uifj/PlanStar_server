# 0015. An object opens as a page

Status: superseded-by-0017 for the historical custom UI implementation; design intent retained
Date: 2026-10-15

## Context

After the three-column shell (0014) an object could only be read as a row in a view or
peeked in the right-hand column. There was no address for one object, so nothing could be
shared or linked to it, and its document - the block body phase 3 gave objects - had no
home except a dev-only page. Anytype opens an object as a page whose body is that document,
with the object's own values above it and its incoming links below.

## Decision

`/object/:objectId?spaceId=…` is the object page, rendered in the shell's middle column.
It shows the first image-valued relation as a banner, the name as an editable field, one
field per value the object's type declares (labelled from the space registry), the objects
that link to it, and - when the object's layout can hold blocks - its document as the page
body. `BlockDocPage` keeps no editor of its own: the drag-reorder list moved into
`BlockDocument`, which both the page and the dev route use. Editing moved the same way:
`PropertyValue` is one field that tracks the value it was given, commits on blur, and
writes nothing when the text is unchanged; the table cell and the object page differ only in
how they turn that string into a relation value.

The peek stays. A row click focuses and opens the context column; the panel's Open action,
and an Open action on each row, hand over to the page.

## Consequences

The page reads the registry for labels and the cover, so its address carries the space; when
it does not, the page falls back to the object's own `spaceId`, which costs one extra render
before the labels appear. Opening any `basic`-layout object now also requests `/blocks`, so
an object without a document pays a round trip and shows the empty state. A `dataview` object
gets its configuration values and no document, because its body is its records; registry
mirrors (`relation`, `objectType`) likewise get a page whose fields cannot be saved, since
their relations are read-only by 0005 - the page shows them rather than pretending otherwise.
There is no heading above the document, matching Anytype, so the properties, the incoming
links and the body read as one column rather than three panels.

## Amendment, 2026-10-16 — preserve page intent in the replacement client

The custom object route, `BlockDocument`, `PropertyValue`, peek flow and layout limits
above belong to the replaced frontend. [0017](0017-hono-rpc-web-client.md) retains the
current Anytype client's object-opening/navigation behaviour and page shell instead of
restoring those components. Keep objects addressable as pages with their cover, name,
properties and surrounding links/comments; [0018](0018-collaborative-document-source.md)
replaces the body with Tiptap/Yjs while keeping header/body interaction boundaries clear.
Set and Chat pages are not wholesale editor rewrites. The shell replacement is current;
real HTTP data, collaborative bodies and legacy-body migration remain staged work, not
features established by the historical page implementation.
