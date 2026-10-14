# Architecture decision records

One file per decision, numbered sequentially, using the reduced MADR shape defined in
[0001](0001-record-architecture-decisions.md). A decision that stops being true keeps its
file and gets a `superseded-by-NNNN` status line.

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | accepted |
| [0002](0002-hybrid-object-storage.md) | Store objects with a hybrid JSONB plus link-table model | accepted |
| [0003](0003-fractional-ordering-last-write-wins.md) | Order by fractional string indexes with last-write-wins | accepted |
| [0004](0004-relation-values-are-arrays.md) | Represent every relation value as an array | accepted |
| [0005](0005-registry-projected-into-objects.md) | Project registry rows into the object table | accepted |
| [0006](0006-space-membership-authorisation.md) | Authorise data by space membership, not by platform role | accepted |
| [0007](0007-registry-validated-query-compiler.md) | Compile filters to raw SQL validated against the relation registry | accepted |
| [0008](0008-vanlife-becomes-a-generated-type.md) | Demote VanLife to a generated type behind compatibility shims | accepted |
| [0009](0009-object-cache-beside-query.md) | Run a normalised object cache beside TanStack Query | accepted |
| [0010](0010-front-web-own-test-rig.md) | Give `front_web` its own test rig instead of joining the workspace | accepted |
| [0011](0011-agent-tools-call-services.md) | Keep agent tools on services and scope chats to a space | accepted |
| [0012](0012-saved-view-is-an-object.md) | A saved view is an object | accepted |

The port runs in seven phases. Phases 0 and 1 (spaces, registry, objects, filtered
lists) and the object-relation edges of phase 2 are implemented; the dataview module
follows 0012.
