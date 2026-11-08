import { afterEach, expect, it, vi } from "vitest";
import { createMdbase } from "@mdbase-dev/sdk";
import manifest from "../generated-mdbase-app.json";
import { plannerDeclaration, plannerEnvironment } from "./sdk-application";

afterEach(() => vi.restoreAllMocks());

it("declares the canonical manifest and opens nothing on construction", () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const open = vi.spyOn(window, "open");
  const declaration = plannerDeclaration("production");
  expect(declaration).toMatchObject({
    id: manifest.id,
    name: manifest.name,
    origin: new URL(manifest.homepage).origin,
    environment: "production",
  });
  const mdbase = createMdbase(declaration);
  expect(mdbase.getSnapshot().phase.kind).not.toBe("ready");
  expect(fetch).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("selects the build environment, defaulting to production", () => {
  expect(plannerEnvironment(undefined)).toBe("production");
  expect(plannerEnvironment("")).toBe("production");
  expect(plannerEnvironment("staging")).toBe("staging");
  expect(plannerEnvironment("lab")).toBe("lab");
  expect(() => plannerEnvironment("local")).toThrow(/VITE_MDBASE_ENV/);
});
