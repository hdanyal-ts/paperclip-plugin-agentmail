# Standalone GitHub repository

This file is a **bootstrap** for maintainers. [THIRD_PARTY_PLUGINS.md](../../../doc/plugins/THIRD_PARTY_PLUGINS.md) explains how any third-party plugin is installed in Paperclip.

## What a standalone publish is (and is not)

| Action | What it means |
|--------|----------------|
| **Push a branch** on a **full Paperclip fork** (e.g. `youruser/paperclip`) with this package under `packages/plugins/…` | You updated the **monorepo**; operators still install the **plugin** from its **dedicated** git repo, a local path, or a release tarball—unless you document otherwise. This is **not** the same as shipping a **plugin-only** repository. |
| **Create** `github.com/…/paperclip-plugin-agentmail` (or your chosen name), **export** this directory (subtree or copy), **tag** `v0.3.0`, push the tag | That is a **standalone plugin** publication for `POST /api/plugins/install` with `git+https://…#v0.3.0`. |
| **`npm publish`** of `@…/paperclip-plugin-agentmail` | Optional; not required for git URL installs. |

**Bottom line:** keep developing in a Paperclip fork if you like, but **source of truth** and **version tags** for end users should live in the **plugin repository** (or your documented install path), not only in monorepo branch pushes.

## 1. Create the GitHub repository

Example (with [GitHub CLI](https://cli.github.com/)) on **your** account (replace `hdanyal-ts` if you use another username):

```bash
gh repo create hdanyal-ts/paperclip-plugin-agentmail --private --description "AgentMail to Paperclip (third-party plugin)"
cd /path/to/work
git clone https://github.com/hdanyal-ts/paperclip-plugin-agentmail.git
cd paperclip-plugin-agentmail
```

A **private** repo is fine. Operators need **git** access from the **Paperclip server** (or they install from a **local path** / **`.tgz`** you supply).

## 2. Copy the package

**Option A — Git subtree** (history for this path only) from a Paperclip fork:

```bash
git subtree split -P packages/plugins/plugin-agentmail-paperclip -b export-agentmail-plugin
cd /path/to/empty-clone
git pull /path/to/paperclip export-agentmail-plugin
```

**Option B — Copy** the contents of `packages/plugins/plugin-agentmail-paperclip/` to the new repo root.

## 3. Add CI and releases

Copy [`publishing/standalone/.github`](publishing/standalone/.github) to the **repository root** if you want the sample workflows. The **release** workflow can upload **`npm pack`** output as a release asset; **npm** registry publish is optional.

## 4. First tag

```bash
npm install
npm run build
npm test
git add -A
git commit -m "chore: initial import"
git push origin main
git tag v0.3.0
git push origin v0.3.0
```

Users then install with:

`"packageName":"git+https://github.com/hdanyal-ts/paperclip-plugin-agentmail.git#v0.3.0"`

## 5. `repository` URLs in `package.json`

Defaults target [hdanyal-ts/paperclip-plugin-agentmail](https://github.com/hdanyal-ts/paperclip-plugin-agentmail). To use another user or org, run `npm pkg set` for `repository`, `bugs`, and `homepage` (or edit by hand) and update `name` / `constants.ts` `PLUGIN_ID` to match your identity.
