import { afterEach, describe, expect, it, vi } from "vitest";
import { MdbaseApplicationUnavailableError } from "@mdbase-dev/sdk";
import { createPlannerApplication } from "./sdk-application";

afterEach(() => vi.restoreAllMocks());

describe("Planner declaration against actual public SDK development shell", () => {
  it("gets the same public singleton, with honest unavailable readiness and no initialization IO", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const open = vi.spyOn(window, "open");
    // jsdom has no module Worker, so the entry is the SDK's honest unavailable shell.
    const sdk = createPlannerApplication({ environment: "production" });
    const application = sdk.application();
    expect(sdk.application()).toBe(application);
    expect(application.getSnapshot().status).toBe("blocked");
    expect(application.getSnapshot().readiness.assessment).toBeNull();
    expect(sdk.connection("fixture-collection")).toBeNull();
    await expect(application.start()).rejects.toBeInstanceOf(
      MdbaseApplicationUnavailableError,
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
});
