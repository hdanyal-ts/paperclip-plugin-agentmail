# Standalone GitHub repository

Maintainers exporting this package out of the Paperclip monorepo can use these steps. Primary **install documentation** lives in **[README.md](./README.md)** (npm, git tag, `.tgz`, local path).

Upstream context: **[THIRD_PARTY_PLUGINS.md](https://github.com/paperclipai/paperclip/blob/master/doc/plugins/THIRD_PARTY_PLUGINS.md)**.

## 1. Create the GitHub repository

Example with [GitHub CLI](https://cli.github.com/):

```bash
gh repo create hdanyal/paperclip-plugin-agentmail --public --description "AgentMail to Paperclip (third-party plugin)"
git clone https://github.com/hdanyal/paperclip-plugin-agentmail.git
cd paperclip-plugin-agentmail
```

## 2. Copy the package into the repo

**Option A — Git subtree** (history for this path only) from a Paperclip fork:

```bash
git subtree split -P packages/plugins/plugin-agentmail-paperclip -b export-agentmail-plugin
cd /path/to/empty-clone
git pull /path/to/paperclip export-agentmail-plugin
```

**Option B — Copy** the contents of **`packages/plugins/plugin-agentmail-paperclip/`** to the repo root.

## 3. CI and releases

Copy [`publishing/standalone/.github`](publishing/standalone/.github) to the **repository root** if you want the sample workflows. Configure **`NPM_TOKEN`** for automated **`npm publish`**, or ship GitHub Releases with **`npm pack`** `.tgz` only.

## 4. Example tag workflow

```bash
npm ci
npm run verify
git add -A
git commit -m "chore: initial import"
git push origin main
git tag v1.0.0
git push origin v1.0.0
```

Example install payload (adjust version):

```json
{"packageName":"git+https://github.com/hdanyal/paperclip-plugin-agentmail.git#v1.0.0"}
```

## 5. `repository` URLs in `package.json`

This package defaults **`repository` / `bugs` / `homepage`** to **`hdanyal/paperclip-plugin-agentmail`**. If you fork under another GitHub identity, update those fields and **`name`** / **`PLUGIN_ID`** in **`src/constants.ts`** consistently.
