#!/usr/bin/env node
/**
 * In the Paperclip monorepo: ensure @paperclipai/plugin-sdk (and shared) are built if dist is missing.
 * In a standalone clone: no-op — npm has prebuilt @paperclipai/plugin-sdk in node_modules.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const monorepoRoot = path.resolve(packageRoot, "..", "..", "..");
const monorepoEnsure = path.join(monorepoRoot, "scripts", "ensure-plugin-build-deps.mjs");

if (fs.existsSync(monorepoEnsure)) {
  const result = spawnSync(process.execPath, [monorepoEnsure], { stdio: "inherit", cwd: monorepoRoot });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
} else {
  const sdkPkg = path.join(packageRoot, "node_modules", "@paperclipai", "plugin-sdk", "package.json");
  if (!fs.existsSync(sdkPkg)) {
    console.error(
      "[paperclip-plugin-agentmail] Run `npm ci` / `npm install` so `@paperclipai/plugin-sdk` is installed from npm.",
    );
    process.exit(1);
  }
}
