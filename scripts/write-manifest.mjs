import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { format } from "prettier";

import { buildPlannerManifest } from "./planner-manifest.mjs";

const development = process.argv.includes("--development");
const appUrl =
  process.env.TASKNOTES_PLANNER_URL ??
  (development ? "http://127.0.0.1:4174" : "https://planner.tasknotes.dev");
const manifest = buildPlannerManifest({ appUrl, development });
const serialized = await format(JSON.stringify(manifest), { parser: "json" });
const targets = [
  resolve(
    import.meta.dirname,
    "..",
    "public",
    ".well-known",
    "mdbase-app.json",
  ),
  resolve(import.meta.dirname, "..", "src", "generated-mdbase-app.json"),
];

await Promise.all(
  targets.map(async (target) => {
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, serialized);
  }),
);
