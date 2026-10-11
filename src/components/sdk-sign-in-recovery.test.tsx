import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describeError, type MdbaseApplicationSnapshot } from "@mdbase-dev/sdk";
import { createApplicationFixture } from "@mdbase-dev/sdk/testing";
import { afterEach, expect, it } from "vitest";
import manifest from "../generated-mdbase-app.json";
import { SdkConnectionGate } from "./sdk-connection-gate";

const owned: ReturnType<typeof createApplicationFixture>[] = [];
afterEach(() => {
  cleanup();
  for (const fixture of owned.splice(0)) fixture.controls.close();
});
function fixture(
  status: MdbaseApplicationSnapshot["status"],
  problem: string | null,
) {
  const facet = { checking: false, assessment: null, problem: null };
  const created = createApplicationFixture({
    declaration: {
      id: manifest.id,
      name: manifest.name,
      origin: new URL(manifest.homepage).origin,
      environment: "lab",
      manifest,
    },
    connections: [],
    initialSnapshot: {
      status,
      problem,
      timing: null,
      signIn: null,
      selectedCollectionId: null,
      collections: [],
      selection: {
        state: "none",
        requested: {
          collectionId: null,
          source: "none",
          displayName: null,
          approved: false,
        },
        usable: null,
        problem: null,
      },
      readiness: {
        ...facet,
        facets: {
          capabilities: facet,
          contracts: facet,
          configuration: facet,
          files: facet,
          people: facet,
          notifications: facet,
        },
      },
    },
  });
  owned.push(created);
  return created;
}
for (const reason of ["refused", "expired"]) {
  it(`SDK ${reason} sign-in has exact copy and calls approve from the enabled button`, () => {
    const h = fixture("blocked", reason);
    const copy = describeError(h.entry.application().getSnapshot());
    if (!copy?.actionLabel) throw new Error("Missing SDK sign-in description");
    render(<SdkConnectionGate sdk={h.entry} onDemo={() => {}} />);
    expect(screen.getByText(copy.title)).toBeTruthy();
    expect(screen.getByText(copy.message)).toBeTruthy();
    const signIn = screen.getByRole("button", { name: copy.actionLabel });
    expect(signIn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(signIn);
    expect(
      h.controls.observedActions().filter((call) => call.action === "approve"),
    ).toHaveLength(1);
    expect(
      h.controls.observedActions().some((call) => call.action === "authorize"),
    ).toBe(false);
  });
}
it("authorizing still offers an enabled explicit SDK approval gesture", () => {
  const h = fixture("authorizing", null);
  render(<SdkConnectionGate sdk={h.entry} onDemo={() => {}} />);
  const signIn = screen.getByRole("button", { name: "Sign in" });
  expect(signIn.hasAttribute("disabled")).toBe(false);
  fireEvent.click(signIn);
  expect(
    h.controls.observedActions().filter((call) => call.action === "approve"),
  ).toHaveLength(1);
});
