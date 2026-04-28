import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const PKG_PATH = join(dir, "..", "package.json");
export const PLUGIN_VERSION = (
  JSON.parse(readFileSync(PKG_PATH, "utf8")) as { version: string }
).version;
