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
          "records.edit",
          "views.manage",
          "definitions.manage",
        ],
      },
    });
    expect(manifest.provisions.type_packs).toHaveLength(1);
    expect(manifest.provisions.type_packs[0].manifest.version).toBe(
      TASKNOTES_TYPE_PACK_VERSION,
    );
    expect(TASKNOTES_TYPE_PACK_VERSION).toBe("0.3.0-rc.12");
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
      provides: manifest.requirements.contracts,
    });
    expect(manifest.provisions.configuration).toEqual([
      expect.objectContaining({
        requirement: "tasknotes-planner-base-sources",
        operation: "set_add",
      }),
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
