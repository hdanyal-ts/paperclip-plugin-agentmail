# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2] - 2026-04-27

### Changed

- **Distribution:** this plugin is **not** published to the **npm** registry. Install from the **GitHub** repo (git tag) or a **Release** **`.tgz`** asset, or a **local path** (see [README](README.md)).
- **`package.json`:** `private: true`; removed `prepublishOnly` and `publishConfig` used for registry publish.

### Documentation

- README: install order is **git tag** (primary), then **release tarball**, then **local path**; removed registry install section.

[0.3.2]: https://github.com/hdanyal-ts/paperclip-plugin-agentmail/releases/tag/v0.3.2

## [0.3.1] - 2026-04-27

### Changed

- **`@paperclipai/plugin-sdk`** dependency range updated to **`^2026.427.0`** (aligns with other publishable Paperclip plugins).
- **npm publish:** `private` is `false`, `prepublishOnly` runs `build`, `publishConfig.access` is `public` for the `@hdanyal-ts` scope.

### Documentation

- README: **install-first** layout (registry, git tag, local path), maintainer publish notes, cross-links to third-party doc.
- STANDALONE: points to README for install; tag example bumped to **v0.3.1**.

[0.3.1]: https://github.com/hdanyal-ts/paperclip-plugin-agentmail/releases/tag/v0.3.1

## [0.3.0] - 2026-04-27

### Changed (breaking for installs on 0.2.0)

- **Independent maintainer scope:** `npm` name **`@hdanyal-ts/paperclip-plugin-agentmail`**, GitHub **`hdanyal-ts/paperclip-plugin-agentmail`**, manifest / plugin id **`hdanyal-ts.paperclip-plugin-agentmail`**. **Reinstall** the plugin and re-register the AgentMail webhook after upgrade. No **employer org** in package metadata; fork as you need.

[0.3.0]: https://github.com/hdanyal-ts/paperclip-plugin-agentmail/releases/tag/v0.3.0

## [0.2.0] - 2026-04-27

### Changed (breaking for earlier installs)

- **Third-party distribution:** not a `@paperclipai/*` or upstream first-party product; not listed in monorepos **Bundled** plugin examples.
- Prior naming iteration used a sample org scope; superseded by **0.3.0** (personal maintainer `hdanyal-ts`).

[0.2.0]: https://github.com/hdanyal-ts/paperclip-plugin-agentmail/releases/tag/v0.2.0

## [0.1.0]

Prior internal iteration under `@paperclipai/plugin-agentmail-paperclip` / `paperclipai.agentmail-paperclip`.
