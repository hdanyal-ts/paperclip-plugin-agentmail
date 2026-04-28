# Contributing

## Scope

Independent third-party plugin: not required to merge into [paperclipai/paperclip](https://github.com/paperclipai/paperclip). Operators install **`@hdanyal/paperclip-plugin-agentmail`** from **[npm](https://www.npmjs.com/package/@hdanyal/paperclip-plugin-agentmail)** or [this Git repository](https://github.com/hdanyal/paperclip-plugin-agentmail) (see upstream [THIRD_PARTY_PLUGINS.md](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/THIRD_PARTY_PLUGINS.md)).

Forks: adjust `package.json` **`name`** / **`repository`**, **`src/constants.ts`** **`PLUGIN_ID`**, manifest author, and `README`/webhook URLs to identities **you** own before publishing forked packages.

## `@paperclipai/plugin-sdk`

In a full **Paperclip** workspace the root **`package.json`** may use **`overrides`** so `^2026.x` can resolve to **`packages/plugins/sdk`** locally. In this repo (standalone **`npm ci`**), **`@paperclipai/plugin-sdk`** comes from **npm**.

## Plugin layout (quick reference)

- **`paperclipPlugin`** in **`package.json`** points at **`dist/manifest.js`**, **`dist/worker.js`**, **`dist/ui/`** after **`npm run build`**.
- Typical layout: **`definePlugin` + `runWorker`** in **`src/worker.ts`**, default manifest export **`src/manifest.ts`**, React settings UI **`src/ui/`**.
- For bundler presets see [`@paperclipai/plugin-sdk/bundlers`](https://www.npmjs.com/package/@paperclipai/plugin-sdk) and **[docs/BUILDING-PAPERCLIP-PLUGINS.md](./docs/BUILDING-PAPERCLIP-PLUGINS.md)**.

## Build

From this repo:

```bash
npm ci
npm run verify
```

From a Paperclip monorepo (optional):

```bash
pnpm --filter @hdanyal/paperclip-plugin-agentmail verify
```

## Releases

- **Semantic versioning** aligned with **`CHANGELOG.md`** and Git tags **`v*.*.*`**.
- **npm:** `npm run release:check`, **`npm publish`** (maintainer `npm login`), or CI with **`NPM_TOKEN`** (see [README](./README.md#maintainers)).

## Pull requests

Open PRs against **[hdanyal/paperclip-plugin-agentmail](https://github.com/hdanyal/paperclip-plugin-agentmail)**. Host bugs belong in **[paperclip](https://github.com/paperclipai/paperclip/issues)** issues; connector behavior belongs here.
