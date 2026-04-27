#!/usr/bin/env node
/**
 * In the Paperclip monorepo: ensure @paperclipai/plugin-sdk (and shared) are built if dist is missing.
 * In a standalone clone: no-op — npm has prebuilt @paperclipai/plugin-sdk in node_modules.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const monorepoRoot = path.resolve(packageRoot, "..", "..", "..");
const monorepoEnsure = path.join(monorepoRoot, "scripts", "ensure-plugin-build-deps.mjs");

if (fs.existsSync(monorepoEnsure)) {
  const result = spawnSync(process.execPath, [monorepoEnsure], { stdio: "inherit", cwd: monorepoRoot });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
} else {
  const require = createRequire(import.meta.url);
  let sdkEntry;
  try {
    sdkEntry = require.resolve("@paperclipai/plugin-sdk");
  } catch {
    console.error(
      "[plugin-agentmail-paperclip] Run `npm install` (or pnpm / yarn) so @paperclipai/plugin-sdk is installed from npm."
    );
    process.exit(1);
  }
  if (!fs.existsSync(sdkEntry)) {
    console.error(`[plugin-agentmail-paperclip] @paperclipai/plugin-sdk resolved to missing file: ${sdkEntry}`);
    process.exit(1);
  }
}
