import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  buildPlannerManifest,
  TASKNOTES_TYPE_PACK_VERSION,
} from "./planner-manifest.mjs";

describe("Planner mdbase manifest", () => {
  it("keeps production callbacks restricted to the production origin", async () => {
    const manifest = await buildPlannerManifest({
      appUrl: "https://planner.tasknotes.dev",
    });
    expect(manifest.homepage).toBe("https://planner.tasknotes.dev/");
    expect(manifest.redirect_uris).toEqual([
      "https://planner.tasknotes.dev/auth/mdbase/callback",
    ]);
    expect(manifest.requirements).toMatchObject({
      access: "full_collection",
      capabilities: {
        contract_version: 2,
        required: [
          "collection.read",
          "records.create",
          "records.edit",
          "views.manage",
          "definitions.manage",
        ],
      },
      files: {
        required: ["list", "read", "add", "replace", "move"],
        scope: { kind: "collection" },
      },
    });
    expect(manifest.provisions.type_packs).toHaveLength(2);
    expect(manifest.provisions.type_packs[0].manifest.version).toBe(
      TASKNOTES_TYPE_PACK_VERSION,
    );
    expect(TASKNOTES_TYPE_PACK_VERSION).toBe("0.3.0-rc.18");
    expect(manifest.provisions.type_packs[0]).toMatchObject({
      manifest: {
        id: "tasknotes.task",
        resources: expect.arrayContaining([
          expect.objectContaining({
            kind: "contract",
            mode: "managed",
            target: "_contracts/tasknotes.task.md",
          }),
          expect.objectContaining({
            kind: "type",
            mode: "seed",
            target: "_types/task.md",
          }),
        ]),
      },
      provides: [manifest.requirements.contracts[0]],
    });
    // Bases discovery needs obsidian.base installed: required and provisioned.
    expect(manifest.requirements.contracts.map(({ id }) => id)).toEqual([
      "tasknotes.task",
      "obsidian.base",
    ]);
    expect(manifest.provisions.type_packs[1]).toMatchObject({
      manifest: { id: "obsidian.base", version: "1.0.0" },
      provides: [manifest.requirements.contracts[1]],
    });
    expect(manifest.requirements.configuration).toEqual([
      {
        id: "tasknotes-planner-base-sources",
        path: "/x-obsidian/bases/include",
        predicate: "contains",
        value: "TaskNotes/Views/**/*.base",
      },
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
    ]);
    // Fresh collections default to Markdown: Bases must be declared as record
    // extensions, not uploaded as opaque files. Preserve Markdown explicitly.
    expect(manifest.provisions.configuration).toEqual([
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
    ]);
  });

  it("publishes exactly the generated production declaration", async () => {
    const manifest = await buildPlannerManifest({
      appUrl: "https://planner.tasknotes.dev",
    });
    expect(manifest.requirements.capabilities).toEqual({
      contract_version: 2,
      required: [
        "collection.read",
        "records.create",
        "records.edit",
        "views.manage",
        "definitions.manage",
      ],
    });
    for (const path of [
      "../public/.well-known/mdbase-app.json",
      "../src/generated-mdbase-app.json",
    ]) {
      expect(
        JSON.parse(await readFile(new URL(path, import.meta.url), "utf8")),
      ).toEqual(manifest);
    }
  });

  it("uses only the documented development origin for callbacks", async () => {
    const manifest = await buildPlannerManifest({
      appUrl: "http://127.0.0.1:4174",
      development: true,
    });
    expect(manifest.redirect_uris).toEqual([
      "http://127.0.0.1:4174/auth/mdbase/callback",
    ]);
  });
});
