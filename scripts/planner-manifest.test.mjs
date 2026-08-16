import { describe, expect, it } from "vitest";

import { buildPlannerManifest } from "./planner-manifest.mjs";

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
        required: expect.arrayContaining([
          "collection.setup.apply",
          "definitions.update",
          "definitions.type-pack.apply",
          "views.execute",
        ]),
      },
    });
    expect(manifest.provisions.type_packs).toHaveLength(1);
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

  it("adds both supported loopback callbacks only for development", async () => {
    const manifest = await buildPlannerManifest({
      appUrl: "http://127.0.0.1:4174",
      development: true,
    });
    expect(manifest.redirect_uris).toEqual([
      "http://127.0.0.1:4174/auth/mdbase/callback",
      "http://localhost:4174/auth/mdbase/callback",
    ]);
  });
});
