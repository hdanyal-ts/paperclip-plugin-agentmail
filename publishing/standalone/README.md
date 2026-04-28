# Standalone GitHub Actions templates

Copy the contents of this directory to the **root** of your plugin repo so `.github/workflows/` sits next to **`package.json`**.

- **`ci.yml`** — on push / PR: `npm ci`, **`npm run verify`** (typecheck, tests, build, **`npm pack`** dry-run).
- **`release.yml`** — on tag `v*.*.*`: **`verify`**, create tarball (**`npm pack --ignore-scripts`**), optionally **`npm publish`** when **`NPM_TOKEN`** is set, attach **`.tgz`** to GitHub Release.

[`package-lock.json`](../../package-lock.json) should exist for **`npm ci`** in CI — run **`npm install`** locally once and commit the lockfile.

Upstream: [THIRD_PARTY_PLUGINS.md](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/THIRD_PARTY_PLUGINS.md). See **[STANDALONE.md](../../STANDALONE.md)** for repo bootstrap notes.
