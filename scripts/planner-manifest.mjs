import { parseAppManifest } from "@mdbase-dev/connect-protocol/manifest";

import { loadCanonicalTaskNotesTypePack } from "./canonical-task-pack.mjs";

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
  const manifest = {
    manifest_version: 1,
    id: "dev.tasknotes.planner",
    name: "TaskNotes Planner",
    homepage: `${origin}/`,
    icon: `${origin}/tasknotes-mark.svg`,
    redirect_uris: redirectUris,
    requirements: {
      contracts: [taskContract],
      capabilities: {
        contract_version: 2,
        required: [...requiredCapabilities],
      },
      access: "full_collection",
      configuration: [
        {
          id: "tasknotes-planner-base-sources",
          path: "/x-obsidian/bases/include",
          predicate: "contains",
          value: "TaskNotes/Views/**/*.base",
        },
      ],
    },
    provisions: {
      type_packs: [typePack],
      configuration: [
        {
          requirement: "tasknotes-planner-base-sources",
          operation: "set_add",
          path: "/x-obsidian/bases/include",
          value: "TaskNotes/Views/**/*.base",
        },
      ],
    },
  };
  // Validate with the installed protocol, without translating v2 to v1.
  parseAppManifest(manifest, { allowLocal: development });
  return manifest;
}
