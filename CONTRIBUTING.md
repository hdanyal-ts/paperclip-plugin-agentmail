# Contributing

## Third-party policy

- This is an **independent** third-party plugin: not required to be merged into [paperclipai/paperclip](https://github.com/paperclipai/paperclip). End users install from **this** project’s git repository (or a local path), per [THIRD_PARTY_PLUGINS.md](../../../doc/plugins/THIRD_PARTY_PLUGINS.md).
- The **`@hdanyal-ts/`** scope and GitHub `repository` URLs in `package.json` are the maintainer defaults; if you **fork** this project, change `name`, `repository`, and manifest `id` in `src/constants.ts` to values **you** own.

## Monorepo note (`@paperclipai/plugin-sdk`)

In a full **Paperclip** workspace, the root `package.json` may use a **pnpm `overrides`** entry so `^2026.x` in this package’s `dependencies` still **links the local** `packages/plugins/sdk` workspace. In a **standalone** clone, `npm install` resolves `@paperclipai/plugin-sdk` from the **npm** registry (that package is first-party; only **this** plugin is third-party).

## Build, typecheck, and test

From this directory (standalone clone):

```bash
npm install
npm run build
npm run typecheck
npm test
```

From a Paperclip monorepo root:

```bash
pnpm --filter @hdanyal-ts/paperclip-plugin-agentmail build
pnpm --filter @hdanyal-ts/paperclip-plugin-agentmail test
```

## Release assets (no public npm required)

- Tag releases in git (e.g. `v0.3.0`); users install with  
  `git+https://github.com/hdanyal-ts/paperclip-plugin-agentmail.git#v0.3.0` in `POST /api/plugins/install`.
- Optional: attach a **`npm pack` tarball** to a **GitHub Release** for air-gapped installs. See [STANDALONE.md](STANDALONE.md) and [publishing/standalone](publishing/standalone).

## Pull requests

Open PRs in **this** plugin repository. For cross-repo Paperclip **host** bugs, use the [paperclip](https://github.com/paperclipai/paperclip) issue tracker; for this connector’s behavior, use **this** repo’s issues.
