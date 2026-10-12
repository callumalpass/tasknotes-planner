import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const TASKNOTES_CONTRACT_CATALOG_URL =
  "https://mdbase.dev/contracts/packs/tasknotes.task/0.3.0-rc.18.json";
export const TASKNOTES_CONTRACT_CATALOG_DIGEST =
  "sha256:9a9ebc26e6f63ad2fc3d92f87d38f6c140a3af90408de47d667ae7b9ba0dc9ef";
export const TASKNOTES_TYPE_PACK_VERSION = "0.3.0-rc.18";

export const TASKNOTES_CONTRACT_VENDOR_PATH = resolve(
  process.cwd(),
  "vendor/mdbase-contracts/tasknotes.task-0.3.0-rc.18.json",
);

export async function loadCanonicalTaskNotesTypePack() {
  const document = await readFile(TASKNOTES_CONTRACT_VENDOR_PATH, "utf8");
  const digest = `sha256:${createHash("sha256").update(document).digest("hex")}`;
  if (digest !== TASKNOTES_CONTRACT_CATALOG_DIGEST) {
    throw new Error(
      `The vendored TaskNotes catalog provision has digest ${digest}; expected ${TASKNOTES_CONTRACT_CATALOG_DIGEST}.`,
    );
  }
  const provision = JSON.parse(document);
  if (
    provision.manifest?.id !== "tasknotes.task" ||
    provision.manifest?.version !== TASKNOTES_TYPE_PACK_VERSION
  ) {
    throw new Error(
      "The vendored TaskNotes catalog provision has the wrong identity.",
    );
  }
  return provision;
}

// Planner lists and runs Obsidian Bases views; discovery needs the obsidian.base
// contract installed in the collection, so the app provisions its canonical pack.
export const BASES_CONTRACT_CATALOG_URL =
  "https://mdbase.dev/contracts/packs/obsidian.base/1.0.0.json";
export const BASES_CONTRACT_CATALOG_DIGEST =
  "sha256:8251b351a4b00c4ea3f4d49988ae45ab52ceaf2420f57ce8105ca4cfe5eafd50";
export const BASES_TYPE_PACK_VERSION = "1.0.0";

export const BASES_CONTRACT_VENDOR_PATH = resolve(
  process.cwd(),
  "vendor/mdbase-contracts/obsidian.base-1.0.0.json",
);

export async function loadCanonicalBasesTypePack() {
  const document = await readFile(BASES_CONTRACT_VENDOR_PATH, "utf8");
  const digest = `sha256:${createHash("sha256").update(document).digest("hex")}`;
  if (digest !== BASES_CONTRACT_CATALOG_DIGEST) {
    throw new Error(
      `The vendored Obsidian Bases catalog provision has digest ${digest}; expected ${BASES_CONTRACT_CATALOG_DIGEST}.`,
    );
  }
  const provision = JSON.parse(document);
  if (
    provision.manifest?.id !== "obsidian.base" ||
    provision.manifest?.version !== BASES_TYPE_PACK_VERSION
  ) {
    throw new Error(
      "The vendored Obsidian Bases catalog provision has the wrong identity.",
    );
  }
  return provision;
}
