import { loadCanonicalTaskNotesTypePack } from "./canonical-task-pack.mjs";

export { TASKNOTES_TYPE_PACK_VERSION } from "./canonical-task-pack.mjs";

export const requiredCapabilities = Object.freeze([
  "collection.inspect",
  "collection.setup.apply",
  "definitions.update",
  "definitions.type-pack.apply",
  "records.watch",
  "records.read",
  "records.query",
  "records.update",
  "views.list",
  "views.execute",
  "views.source.read",
  "views.source.create",
  "views.source.update",
]);

export async function buildPlannerManifest({ appUrl, development = false }) {
  const origin = appUrl.replace(/\/$/, "");
  const redirectUris = [`${origin}/auth/mdbase/callback`];
  if (development && origin === "http://127.0.0.1:4174")
    redirectUris.push("http://localhost:4174/auth/mdbase/callback");
  const typePack = await loadCanonicalTaskNotesTypePack();
  const taskContract = typePack.provides.find(
    (contract) => contract.id === "tasknotes.task",
  );
  if (!taskContract)
    throw new Error("TaskNotes pack provides no task contract.");
  return {
    manifest_version: 1,
    id: "dev.tasknotes.planner",
    name: "TaskNotes Planner",
    homepage: `${origin}/`,
    icon: `${origin}/tasknotes-mark.svg`,
    redirect_uris: redirectUris,
    requirements: {
      contracts: [taskContract],
      capabilities: {
        contract_version: 1,
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
}
