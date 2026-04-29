#!/usr/bin/env node
/**
 * Register or refresh this plugin on a running Paperclip instance (dev workflow).
 *
 * - No row yet: POST /api/plugins/install with this repo as local path.
 * - Already ready / upgrade_pending: POST /api/plugins/:id/upgrade (re-reads disk).
 *
 * Works without cookies when the host runs in local_trusted ("pnpm dev" default).
 * For authenticated boards, set PAPERCLIP_COOKIE to the Cookie header value from
 * your logged-in browser session.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const out = {
    build: false,
    origin: process.env.PAPERCLIP_ORIGIN ?? "http://127.0.0.1:3100",
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--build" || a === "-b") out.build = true;
    else if (a === "--origin" && argv[i + 1]) out.origin = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function readPackageName() {
  const p = path.join(repoRoot, "package.json");
  const j = JSON.parse(readFileSync(p, "utf8"));
  if (typeof j.name !== "string") throw new Error("package.json missing name");
  return j.name;
}

function requestHeaders() {
  const headers = { "Content-Type": "application/json" };
  const cookie = process.env.PAPERCLIP_COOKIE;
  if (cookie) headers.Cookie = cookie;
  return headers;
}

async function readJsonOrText(res) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage: node scripts/install-dev-to-paperclip.mjs [options]

  --build, -b      Run package build (pnpm or npm) before syncing
  --origin URL     Paperclip base URL (default: $PAPERCLIP_ORIGIN or http://127.0.0.1:3100)

Environment:
  PAPERCLIP_ORIGIN    Base URL (e.g. http://127.0.0.1:3100)
  PAPERCLIP_COOKIE    Optional full Cookie header when not using local_trusted`);
    process.exit(0);
  }

  if (args.build) {
    const tsconfig = path.join(repoRoot, "tsconfig.json");
    if (!existsSync(tsconfig)) {
      console.error(
        "Cannot --build: no tsconfig.json (this checkout may be npm-installed with only dist/).\n" +
          "Use a full git clone for rebuild + sync, or omit --build if dist/ is already up to date.",
      );
      process.exit(1);
    }
    const usePnpm = existsSync(path.join(repoRoot, "pnpm-lock.yaml"));
    const cmd = usePnpm ? "pnpm" : "npm";
    const r = spawnSync(cmd, ["run", "build"], {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }

  const manifestJs = path.join(repoRoot, "dist", "manifest.js");
  if (!existsSync(manifestJs)) {
    console.error("Missing dist/manifest.js — run: pnpm run build");
    process.exit(1);
  }

  const packageName = readPackageName();
  const origin = args.origin.replace(/\/$/, "");
  const headers = requestHeaders();

  const listRes = await fetch(`${origin}/api/plugins`, { headers });
  const listParsed = await readJsonOrText(listRes);
  if (!listRes.ok) {
    console.error(`GET /api/plugins failed: ${listRes.status} ${listParsed.text}`);
    process.exit(1);
  }

  const plugins = listParsed.json;
  if (!Array.isArray(plugins)) {
    console.error("GET /api/plugins returned unexpected body (expected JSON array)");
    process.exit(1);
  }

  const existing = plugins.find((p) => p.packageName === packageName) ?? null;

  if (existing && (existing.status === "ready" || existing.status === "upgrade_pending")) {
    const up = await fetch(`${origin}/api/plugins/${existing.id}/upgrade`, {
      method: "POST",
      headers,
      body: "{}",
    });
    const upParsed = await readJsonOrText(up);
    if (!up.ok) {
      console.error(`POST /api/plugins/:id/upgrade failed: ${up.status} ${upParsed.text}`);
      process.exit(1);
    }
    console.log("Synced (upgrade):", packageName, "→", origin);
    return;
  }

  if (existing) {
    console.error(
      `Plugin is registered but status is "${existing.status}". ` +
        `Use Plugin Manager to enable it, or fix errors, then run this script again.`,
    );
    process.exit(1);
  }

  const installRes = await fetch(`${origin}/api/plugins/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      packageName: repoRoot,
      isLocalPath: true,
    }),
  });
  const installParsed = await readJsonOrText(installRes);

  if (installRes.ok) {
    console.log("Synced (install):", packageName, "→", origin);
    return;
  }

  const errMsg = installParsed.json?.error ?? installParsed.text;
  if (
    installRes.status === 400 &&
    typeof errMsg === "string" &&
    errMsg.toLowerCase().includes("already installed")
  ) {
    const listRes2 = await fetch(`${origin}/api/plugins`, { headers });
    const p2 = await readJsonOrText(listRes2);
    const again = Array.isArray(p2.json)
      ? p2.json.find((p) => p.packageName === packageName)
      : null;
    if (again && (again.status === "ready" || again.status === "upgrade_pending")) {
      const up = await fetch(`${origin}/api/plugins/${again.id}/upgrade`, {
        method: "POST",
        headers,
        body: "{}",
      });
      if (up.ok) {
        console.log("Synced (upgrade after conflict):", packageName, "→", origin);
        return;
      }
    }
  }

  console.error(`POST /api/plugins/install failed: ${installRes.status} ${installParsed.text}`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
