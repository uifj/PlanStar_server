/**
 * Desktop-shell intake defaults.
 *
 * The Electron shell (front_web/electron) talks to three endpoints under `/api/desktop`:
 * a release manifest for the auto-updater, a crash-report sink, and a feedback intake. These
 * constants keep the wire details (content type, default channel) in one place so the router,
 * service and the shell's `manifestProvider.ts` agree without magic strings scattered around.
 */

/** Channel the shell sends as `X-Release-Channel` / `?channel=` when none is configured. */
export const DESKTOP_RELEASE_CHANNEL_DEFAULT = "stable";

/**
 * Content type of the release manifest. The shell's `manifestProvider` sends
 * `Accept: application/yaml, text/yaml, text/plain;q=0.9` and parses the body as flat YAML, so the
 * server answers with `text/yaml` rather than JSON.
 */
export const DESKTOP_MANIFEST_CONTENT_TYPE = "text/yaml; charset=utf-8";

/** Values of `DESKTOP_RELEASE_FORCED` that mean "this release is mandatory". */
export const FORCED_TRUTHY = new Set(["1", "true", "yes", "on"]);
