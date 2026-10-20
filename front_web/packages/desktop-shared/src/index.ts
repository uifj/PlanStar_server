/**
 * `@harness/desktop-shared` — the cross-process contract for the front_web desktop shell.
 *
 * One import site for main, preload and renderer: IPC channel names, command ids, payload types and
 * the `window.Desktop` wire interface. Pure TypeScript with zero runtime dependencies and no
 * `electron` import, so it compiles once (ES2020, this package's own tsconfig) and every consumer —
 * including the ES5-lib renderer — depends only on the emitted declarations.
 */

export * from "./bridge-api";
export * from "./channels";
export * from "./commands";
export * from "./types";
