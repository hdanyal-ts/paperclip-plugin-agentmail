# Standalone GitHub repository

This file is a **bootstrap for maintainers** who copy this package out of the Paperclip monorepo. End-user **install** options (git tag, release `.tgz`, local path) are in **[README.md](./README.md)** first.

[THIRD_PARTY_PLUGINS.md](../../../doc/plugins/THIRD_PARTY_PLUGINS.md) explains how any third-party plugin is installed in Paperclip.

## 1. Create the GitHub repository

Example (with [GitHub CLI](https://cli.github.com/)) (replace `hdanyal-ts` if you use another account):

```bash
gh repo create hdanyal-ts/paperclip-plugin-agentmail --private --description "AgentMail to Paperclip (third-party plugin)"
cd /path/to/work
git clone https://github.com/hdanyal-ts/paperclip-plugin-agentmail.git
cd paperclip-plugin-agentmail
```

A **private** repo is fine. Operators need **git** access from the **Paperclip server** (or they install from **local path** / **`.tgz`** you supply).

## 2. Copy the package

**Option A — Git subtree** (history for this path only) from a Paperclip fork:

```bash
git subtree split -P packages/plugins/plugin-agentmail-paperclip -b export-agentmail-plugin
cd /path/to/empty-clone
git pull /path/to/paperclip export-agentmail-plugin
```

**Option B — Copy** the contents of `packages/plugins/plugin-agentmail-paperclip/` to the new repo root.

## 3. Add CI and releases

Copy [`publishing/standalone/.github`](publishing/standalone/.github) to the **repository root** if you want the sample workflows. The **release** workflow runs **`npm pack`** and can attach the **`.tgz`** to a GitHub Release (no public npm registry required; see [README.md](./README.md) “Maintainers: GitHub releases”).

## 4. First tag

```bash
npm install
npm run build
npm test
git add -A
git commit -m "chore: initial import"
git push origin main
git tag v0.3.2
git push origin v0.3.2
```

Users can install with:

`"packageName":"git+https://github.com/hdanyal-ts/paperclip-plugin-agentmail.git#v0.3.2"`

(Adjust the version to match your tag.)

## 5. `repository` URLs in `package.json`

Defaults target [hdanyal-ts/paperclip-plugin-agentmail](https://github.com/hdanyal-ts/paperclip-plugin-agentmail). To use another user or org, run `npm pkg set` for `repository`, `bugs`, and `homepage` (or edit by hand) and update `name` / `constants.ts` `PLUGIN_ID` to match your identity.
