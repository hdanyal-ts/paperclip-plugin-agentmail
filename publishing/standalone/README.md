# Standalone GitHub Actions templates

Copy the contents of this directory to the **root** of your plugin’s git repository (so `.github/workflows/` sits next to `package.json`).

- **ci.yml** — on push/PR: `npm install`, typecheck, test, build.
- **release.yml** — on tag `v*.*.*`: test, build, `npm pack`, upload the resulting **`.tgz`** to a **GitHub Release** (see [third-party plugins](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/THIRD_PARTY_PLUGINS.md) — no public npm account required).

**Optional public npm publish:** if you add `"private": false` and a registry token, you can add a step or a separate job with `NPM_TOKEN`.

For a reproducible `pnpm ci` in CI, run `npm install` once locally, commit **`package-lock.json`**, and change the **Install** step to `npm ci`.

See [STANDALONE.md](../../STANDALONE.md).
