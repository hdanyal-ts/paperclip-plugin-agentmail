# Building Paperclip plugins (short reference)

Applies to plugins that use [`@paperclipai/plugin-sdk`](https://www.npmjs.com/package/@paperclipai/plugin-sdk). See [paperclip-aperture](https://github.com/tomismeta/paperclip-aperture) for a full production example.

## Artifacts

- **Worker** — Node ESM entry (often `dist/worker.js` or emitted under `dist/`).
- **Manifest** — `PaperclipPluginManifestV1` default export (often `dist/manifest.js`).
- **UI** — Browser ESM under `dist/ui/` (e.g. `index.js`).

## `package.json`

- **`paperclipPlugin`:** `{ "manifest", "worker", "ui" }` paths after build.
- **`prepack`:** run full `build` so `npm pack` / `npm publish` never ships stale output.
- **`verify`:** typecheck + tests + build + `npm pack --dry-run` (recommended).
- **`files`:** restrict to `dist/**` + documentation you intend to ship.

## UI bundling

Use [`createPluginBundlerPresets`](https://www.npmjs.com/package/@paperclipai/plugin-sdk) from `@paperclipai/plugin-sdk/bundlers` with esbuild, or mirror its **externals** if you bundle UI yourself: `@paperclipai/plugin-sdk/ui`, `@paperclipai/plugin-sdk/ui/hooks`, `react`, `react-dom`, `react/jsx-runtime`.


- [Paperclip plugin spec](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/PLUGIN_SPEC.md)
- [THIRD_PARTY_PLUGINS.md](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/THIRD_PARTY_PLUGINS.md)
