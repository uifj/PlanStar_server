# 0025. Desktop auto-update reads electron-builder's feed, not a hand-rolled provider

Status: accepted
Date: 2026-10-21
Relates to: [0024](0024-desktop-shell-serves-the-web-renderer.md) — the shell whose "no auto-update"
consequence this record replaces; [0020](0020-client-first-command-shim-transport.md) — the command
bus the download/install actions ride on.

## Context

0024 shipped the shell without an updater: `identity: null` packaging, a `dir` + `dmg` target and no
publish configuration. `electron/main/autoUpdater.ts` still existed, but it was a shadow
implementation — its own version comparison, its own artifact download, its own sha512 handling, and
a manifest reader that built artifact URLs from `DESKTOP_RELEASE_*` values on the server. Nothing
verified that the file it downloaded was the file the server meant, and `electron-updater` was not
even in `package.json`.

Three properties of that situation were unacceptable:

* **Two sources of truth for "which artifact is current".** The server's `/releases/manifest` is a
  policy channel: `is_forced`, human release notes, and which version the fleet should be on. It is
  not a build artifact, and hand-building a download URL from it means the client can download a
  package the build never produced.
* **No integrity check.** A hand-rolled download that stores no digest cannot prove the bytes match
  the release.
* **Unverifiable install path.** Squirrel.Mac installs a `.zip`, which the packaging target did not
  even emit.

## Decision

**`electron-updater` is the updater; the server only forwards what electron-builder wrote.**

1. **Generic provider, builder metadata as the artifact truth.** `electron-builder.yml` gains a `zip`
   target and a `publish` block (`provider: generic`, a placeholder URL — nothing is uploaded;
   `--publish never` is how it is invoked). Packaging then emits `build/latest-mac.yml` (version, file
   name, sha512) and, inside the app, `Resources/app-update.yml`. The builds are copied to
   `$DESKTOP_DATA_ROOT/releases/`, and the backend serves them verbatim at
   `GET /api/desktop/releases/feed/{filename}` — a static passthrough with filename allow-listing and
   no rewriting of any field. sha512 verification happens inside the updater, on the file the builder
   hashed.
2. **`/releases/manifest` keeps only what builder metadata cannot express.** `is_forced` and the
   human-readable release notes. `autoUpdater.ts` consults it *after* the updater reports
   `update-available`, and only to decide whether to raise the force-update guard; it never uses it to
   locate or validate an artifact. The two endpoints therefore have disjoint jobs, and either can be
   read without inferring the other.
3. **The feed URL is resolved at runtime, not baked in.** `updater.setFeedURL({ provider: "generic",
   url: `${apiUrl()}/api/desktop/releases/feed/` })` — the same `HARNESS_API_URL` the renderer dials.
   This also sets the updater's internal `clientPromise`, so the packaged `app-update.yml` is never
   read: one configurable backend per install, no rebuild to change it.
4. **The policy is fixed and has no preferences UI.** `autoDownload = true`,
   `autoInstallOnAppQuit = false`, `allowPrerelease = false`. Background download, explicit install
   (menu item or the force-update modal). The `Get/SetAutoUpdatePreferences` pair, the
   `skippedVersions` list and the "acknowledge release notes" channel are deleted rather than left
   unimplemented — a settings surface with nothing behind it is worse than none.
5. **Deployment order is server first, then client.** An old server answering 404 for a newer
   client's feed maps to a normal `error` state, not a crash; a new server answering an old client is
   harmless.

## Consequences

* Gained: the updater verifies sha512 against the file the build produced, and `latest-mac.yml` +
   `*.zip` + `app-update.yml` are asserted in CI (`desktop-package` job), so the "publish config
   quietly deleted" and "zip target quietly deleted" regressions fail before merge.
* Accepted: an unsigned (`identity: null`) build can only be verified up to
  `update-downloaded` — Squirrel.Mac refuses to install a package whose signature it cannot check.
  The shell reports that failure as an `error` state rather than attempting an install on quit
  (`autoInstallOnAppQuit = false`). Real installation needs a Developer ID, which is a separate
  decision.
* Accepted: no automatic updates in development. The controller is constructed only when
  `featureFlags.autoUpdate && app.isPackaged`, and that same constant feeds `desktop.capabilities()`
  — so capability reporting and wiring cannot disagree.
* Accepted: release notes are shown by the updater's own `update-available` payload, not by a
  post-install "what's new" dialog. The `PostUpdateReleaseNotes` channel had no producer and is gone.
* Rejected: a custom `Provider<UpdateInfo>` (must re-implement the updater's provider lifecycle,
  sha512 and differential logic against private API shapes — breaks on its next release); a server
  that synthesises `latest-mac.yml` from `DESKTOP_RELEASE_*` env vars (drifts from the builder's
  output, and any mismatch means downloading the wrong package); keeping the preferences UI and
  leaving it unwired.
