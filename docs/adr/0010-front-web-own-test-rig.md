# 0010. Give front_web its own test rig instead of joining the workspace

Status: accepted
Date: 2026-10-13

## Context

The client has no test tooling at all: no test script, no vitest, no testing library, zero test files. It is also not a member of the root pnpm workspace, so pnpm install at the root silently does nothing for it.

## Decision

Add vitest, jsdom, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom and msw to front_web, with front_web/vitest.config.ts extending the existing Vite config so the @ alias and Tailwind plugin are inherited, plus test and test:watch scripts. Dependencies stay installed with pnpm install --ignore-workspace.

## Consequences

There are two installs and two gates to run locally, and nothing enforces either because the repository has no working CI. Making the client a workspace member would unify installs but would also merge lockfiles and change how the API image is built, which is a larger and separately reversible decision.
