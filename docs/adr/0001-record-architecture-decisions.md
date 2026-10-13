# 0001. Record architecture decisions

Status: accepted
Date: 2026-10-13

## Context

The repository is about to change shape: an Anytype-style object core is being introduced underneath a codebase that was built as a van-rental API. Several of those choices are expensive to undo, and docs/architecture.md and docs/conventions.md describe the current rules but not the reasons behind them. docs/ADR/ existed as an empty directory with no numbering or template.

## Decision

Keep one file per decision under docs/adr/, numbered sequentially (0002-hybrid-object-storage.md), using a reduced MADR shape: Status, Date, Context, Decision, Consequences. docs/adr/README.md indexes them. A superseded decision keeps its file and gets a status line pointing at the replacement so the reasoning stays readable.

## Consequences

Decisions are recorded where the code is, so a reviewer sees the constraint next to the change that obeys it. The cost is upkeep: a record that stops being true has to be superseded explicitly rather than quietly ignored.
