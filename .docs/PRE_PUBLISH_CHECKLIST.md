# Pre-publish checklist (maintainers)

Run before tagging **`v*`** / publishing **`@hdanyal/paperclip-plugin-agentmail`**.

## Tarball

- `npm run verify` (includes `npm pack --dry-run`).
- Inspect `npm pack --json` output: no secrets, no stray paths; `files` lists only runtime + docs you intend. **`scripts/install-dev-to-paperclip.mjs`** is included on purpose so `paperclip:dev-sync*` scripts work from the tarball; it is not a runtime dependency of the plugin.

## Clean install smoke

Exercise at least one install path outside this clone: **npm package**, **git tag URL**, or **local `.tgz`**.

## Paperclip smoke (manual)

Representative flows: plugin settings UI loads, webhook URL matches **`hdanyal.paperclip-plugin-agentmail`**, Svix verification rejects invalid signatures, inbound message creates or updates issue, WebSocket reconnect on config change, unread catch-up, attachments, agent tools scoped to inbox.

## Versions aligned

**`package.json` `version`**, **`CHANGELOG`**, Git tag (**`v*`** matches semver), npm version, and README examples.

## License & attribution

MIT text in **LICENSE**, **`package.json` `author`**, and **`repository`** match canonical maintainership.

## CI secrets

Configure **`NPM_TOKEN`** if you want the [Release workflow](../.github/workflows/release.yml) to run **`npm publish`**. Omit to ship GitHub Releases + `.tgz` only.
