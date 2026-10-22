# Secrets for the podman stack

`compose.yaml` bind-mounts this directory read-only at `/run/secrets`, and
`deploy/docker/entrypoint.sh` copies each file's contents into the matching environment variable.
That is the same delivery mechanism quadlet uses (`Secret=...,type=env`), so the compose stack and
the systemd stack read byte-identical inputs.

Nothing in here is committed (`secrets/*` is gitignored; only this README and `.gitkeep` are
tracked). Create the three files the API requires:

```bash
cd deploy/podman

printf '%s' "$(openssl rand -base64 48)" > secrets/better_auth_secret
printf '%s' "$(openssl rand -base64 24 | tr -d '/+=')" > secrets/postgres_password
printf '%s' "$(openssl rand -base64 32 | tr -d '/+=')" > secrets/desktop_log_read_token
chmod 0600 secrets/*

# optional — leave absent if the deployment does not run agent turns
printf '%s' 'AIza...' > secrets/gemini_api_key
printf '%s' 'sk-...'   > secrets/deepseek_api_key
```

| File | Env var | Required | Notes |
|---|---|---|---|
| `better_auth_secret` | `BETTER_AUTH_SECRET` | yes | Signing key for session tokens. Rotating it signs every user out. |
| `postgres_password` | `POSTGRES_PASSWORD` | yes | Also feeds the `postgres` container and the assembled `DATABASE_URL`. |
| `desktop_log_read_token` | `DESKTOP_LOG_READ_TOKEN` | yes in production | Bearer token for `GET /api/desktop/logs*`. Unset closes the read surface (404). |
| `gemini_api_key` | `GEMINI_API_KEY` | no | Agent model provider. |
| `deepseek_api_key` | `DEEPSEEK_API_KEY` | no | Alternative provider. |

Rules that matter:

- **No trailing newline.** `printf '%s'`, not `echo`. A stray `\n` inside a password is an
  auth failure with no useful error message.
- **Fixed names.** `compose.yaml` references these exact paths; renaming a file here means editing
  `*_FILE` in `compose.yaml` and the `Secret=` lines in `quadlet/`.
- **Real permissions.** `0600` and owned by the deploying user. The api container runs as `node`
  (uid 1000) and only needs read access; `chmod 0644` also works but widens the blast radius on a
  shared host.
- **No `$` interpolation.** These files are read verbatim. `openssl rand -base64` output can contain
  `+` and `/`; that is fine in a password and fine in the URL because `entrypoint.sh` only
  concatenates, it does not URL-encode. Avoid `#`, `@`, `:` and `/` in the *postgres* password if
  the URL assembler is in play — the `tr -d '/+='` above keeps it to alphanumerics for that reason.
