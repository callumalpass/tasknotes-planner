import { parseAppManifest } from "@mdbase-dev/connect-protocol/manifest";

import {
  loadCanonicalBasesTypePack,
  loadCanonicalTaskNotesTypePack,
} from "./canonical-task-pack.mjs";

export { TASKNOTES_TYPE_PACK_VERSION } from "./canonical-task-pack.mjs";

export const requiredCapabilities = Object.freeze([
  "collection.read",
  "records.edit",
  "views.manage",
  "definitions.manage",
]);

export async function buildPlannerManifest({ appUrl, development = false }) {
  const origin = appUrl.replace(/\/$/, "");
  const redirectUris = [`${origin}/auth/mdbase/callback`];
  const typePack = await loadCanonicalTaskNotesTypePack();
  const taskContract = typePack.provides.find(
    (contract) => contract.id === "tasknotes.task",
  );
  if (!taskContract)
    throw new Error("TaskNotes pack provides no task contract.");
  const basesPack = await loadCanonicalBasesTypePack();
  const basesContract = basesPack.provides.find(
    (contract) => contract.id === "obsidian.base",
  );
  if (!basesContract)
    throw new Error("Obsidian Bases pack provides no obsidian.base contract.");
  const manifest = {
    manifest_version: 1,
    id: "dev.tasknotes.planner",
    name: "TaskNotes Planner",
    homepage: `${origin}/`,
    icon: `${origin}/tasknotes-mark.svg`,
    redirect_uris: redirectUris,
    requirements: {
      contracts: [taskContract, basesContract],
      capabilities: {
        contract_version: 2,
        required: [...requiredCapabilities],
      },
      access: "full_collection",
      // Next accounts approve each record capability together with its file
      // actions: reading needs list and read, editing needs replace and move.
      files: {
        required: ["list", "read", "replace", "move"],
        scope: { kind: "collection" },
      },
      configuration: [
        {
          id: "tasknotes-planner-base-sources",
          path: "/x-obsidian/bases/include",
          predicate: "contains",
          value: "TaskNotes/Views/**/*.base",
        },
        // The canonical obsidian.base type stores YAML document records.
        // record_extensions is a complete set: retain Markdown explicitly.
        {
          id: "tasknotes-planner-markdown-records",
          path: "/settings/record_extensions",
          predicate: "contains",
          value: "md",
        },
        {
          id: "tasknotes-planner-base-records",
          path: "/settings/record_extensions",
          predicate: "contains",
          value: "base",
        },
      ],
    },
    provisions: {
      type_packs: [typePack, basesPack],
      configuration: [
        {
          requirement: "tasknotes-planner-base-sources",
          operation: "set_add",
          path: "/x-obsidian/bases/include",
          value: "TaskNotes/Views/**/*.base",
        },
        {
          requirement: "tasknotes-planner-markdown-records",
          operation: "set_add",
          path: "/settings/record_extensions",
          value: "md",
        },
        {
          requirement: "tasknotes-planner-base-records",
          operation: "set_add",
          path: "/settings/record_extensions",
          value: "base",
        },
      ],
    },
  };
  // Validate with the installed protocol, without translating v2 to v1.
  parseAppManifest(manifest, { allowLocal: development });
  return manifest;
}
