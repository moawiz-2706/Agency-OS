import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Load .env from the repo root, no matter where we're started from:
// apps/mcp/{src,dist}[/cli] -> walk up to the folder with pnpm-workspace.yaml.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, here.endsWith("cli") ? "../../../.." : "../../..");
loadEnv({ path: path.join(root, ".env"), quiet: true });
