import { describe, expect, it } from "vitest";

import { buildPlannerManifest } from "./planner-manifest.mjs";

describe("Planner mdbase manifest", () => {
  it("keeps production callbacks restricted to the production origin", () => {
    const manifest = buildPlannerManifest({
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
          "views.execute",
        ]),
      },
    });
    expect(manifest.provisions).toMatchObject({ type_packs: [] });
    expect(manifest.provisions.configuration).toEqual([
      expect.objectContaining({
        requirement: "tasknotes-planner-base-sources",
        operation: "set_add",
      }),
    ]);
  });

  it("adds both supported loopback callbacks only for development", () => {
    const manifest = buildPlannerManifest({
      appUrl: "http://127.0.0.1:4174",
      development: true,
    });
    expect(manifest.redirect_uris).toEqual([
      "http://127.0.0.1:4174/auth/mdbase/callback",
      "http://localhost:4174/auth/mdbase/callback",
    ]);
  });
});
