import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";

export const requiredCapabilities = Object.freeze([
  "collection.inspect",
  "collection.setup.apply",
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

export function buildPlannerManifest({ appUrl, development = false }) {
  const origin = appUrl.replace(/\/$/, "");
  const redirectUris = [`${origin}/auth/mdbase/callback`];
  if (development && origin === "http://127.0.0.1:4174")
    redirectUris.push("http://localhost:4174/auth/mdbase/callback");
  return {
    manifest_version: 1,
    id: "dev.tasknotes.planner",
    name: "TaskNotes Planner",
    homepage: `${origin}/`,
    icon: `${origin}/tasknotes-mark.svg`,
    redirect_uris: redirectUris,
    requirements: {
      contracts: [
        {
          id: "tasknotes.task",
          version: TASKNOTES_SPEC_VERSION,
          digest: TASKNOTES_CONTRACT_DIGEST,
        },
      ],
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
      type_packs: [],
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
