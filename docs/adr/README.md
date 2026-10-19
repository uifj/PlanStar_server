# Architecture decision records

One file per decision, numbered sequentially, using the reduced MADR shape defined in
[0001](0001-record-architecture-decisions.md). A decision that stops being true keeps its
file and gets a `superseded-by-NNNN` status line. Partial supersessions name their scope;
amendments preserve the original reasoning. **Accepted is a decision status, not proof
of implementation.** New migration records state pending/staged implementation explicitly.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | accepted |
| [0002](0002-hybrid-object-storage.md) | Store objects with a hybrid JSONB plus link-table model | accepted |
| [0003](0003-fractional-ordering-last-write-wins.md) | Order by fractional string indexes with last-write-wins | body authority/concurrency superseded-by-0018; non-body fractional ordering retained |
| [0004](0004-relation-values-are-arrays.md) | Represent every relation value as an array | accepted |
| [0005](0005-registry-projected-into-objects.md) | Project registry rows into the object table | accepted |
| [0006](0006-space-membership-authorisation.md) | Authorise data by space membership, not by platform role | accepted |
| [0007](0007-registry-validated-query-compiler.md) | Compile filters to raw SQL validated against the relation registry | accepted |
| [0008](0008-vanlife-becomes-a-generated-type.md) | Demote VanLife to a generated type behind compatibility shims | accepted |
| [0009](0009-object-cache-beside-query.md) | Run a normalised object cache beside TanStack Query | superseded-by-0019; never implemented |
| [0010](0010-front-web-own-test-rig.md) | Give `front_web` its own test rig instead of joining the workspace | accepted, amended; independent boundaries retained, new gates pending |
| [0011](0011-agent-tools-call-services.md) | Keep agent tools on services and scope chats to a space | accepted |
| [0012](0012-saved-view-is-an-object.md) | A saved view is an object | accepted, amended; ownership mapping and migration pending |
| [0013](0013-documents-are-ordered-blocks.md) | Documents are ordered blocks | body source superseded-by-0018; migration pending |
| [0014](0014-three-column-workspace-shell.md) | The workspace lives in a three-column shell | historical custom UI superseded-by-0017; design intent retained |
| [0015](0015-object-opens-as-a-page.md) | An object opens as a page | historical custom UI superseded-by-0017; design intent retained |
| [0016](0016-type-scale-follows-anytype-by-role.md) | Text size follows the role, on Anytype's scale | historical custom UI superseded-by-0017; design intent retained |
| [0017](0017-hono-rpc-web-client.md) | Use Hono typed HTTP RPC for the Web client | accepted; migration-phase transport amended-by-0020; typed-route end state pending |
| [0018](0018-collaborative-document-source.md) | Make the collaborative document the sole body source | accepted; implementation pending, staged |
| [0019](0019-authorised-subscription-events.md) | Feed MobX with authorised subscription events | accepted; implementation pending, staged |
| [0020](0020-client-first-command-shim-transport.md) | Run the shell's command surface on a client-first shim during migration | accepted; shim + first boot slice implemented, typed end state pending |
| [0021](0021-keep-rest-api-mark-superseded.md) | Keep the pre-pivot REST API mounted, mark the operations the shim superseded deprecated | accepted; implemented |
| [0022](0022-type-recommended-layout.md) | Inherit a type's recommended layout at create, reset it on demand | accepted; implemented (layout half only) |

## Current migration status, 2026-10-16

The custom REST frontend described by the earlier UI records has been replaced in
`front_web/src` by the actual Anytype-style client and its MobX/SCSS shell. Its business
transport still targets the absent anytype-heart gRPC-web service at the migration
baseline; an authentication screen is not evidence of working backend integration.
ADRs 0017–0019 accept staged migration to Hono typed HTTP, existing Better Auth accounts
instead of mnemonics, Hocuspocus/Yjs + Tiptap bodies and authorised MobX/SSE subscriptions.
The target is self-hosted Web equivalents, with no gRPC bridge or any-sync interoperability,
while retaining the current shell. As of this update the first boot slice works: a Better
Auth session boots the shell through the [0020](0020-client-first-command-shim-transport.md)
command shim into a real empty space (`/main/void/empty`). That proves login and space
provisioning only; object create/open, Tiptap body editing and two-client sync remain
separate pending slices. Neither this decision update nor a first working slice means the
full migration is implemented. ADRs 0002, 0004–0008 and 0011 remain in force.

## Historical implementation report

The previous index summary is retained below only as history of the replaced custom
frontend port, not as the completion status of the current client or the new migration:

> The port's seven phases are all implemented: phases 0 and 1 (spaces, registry, objects,
> filtered lists), phase 2 (relation edges, saved views, the filter performance gate),
> phase 3 (block documents), phase 4 (VanLife behind the kernel), phase 5 (agent tools on
> services) and phase 6-7 (the space browser, its stored layouts and the shell). Deferred
> work is recorded in the amendments, not in this index.
