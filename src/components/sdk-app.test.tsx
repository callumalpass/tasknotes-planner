import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createTestMdbase,
  type TestAppPreset,
  type TestMdbase,
} from "@mdbase-dev/sdk/testing";

vi.mock("../data/next-planner-repository", async () => {
  const { DemoPlannerRepository } = await import("../data/demo-repository");
  return {
    NextPlannerRepository: class extends DemoPlannerRepository {
      constructor() {
        super();
      }
      dispose() {}
    },
  };
});

import SdkApp from "./sdk-app";

const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })),
  );
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

const mdbases: TestMdbase[] = [];
afterEach(async () => {
  for (const mdbase of mdbases.splice(0)) await mdbase.fixture.close();
});

async function testMdbase(phase: TestAppPreset) {
  const mdbase = await createTestMdbase({
    collections: [{ name: "Launch plan" }],
    phase,
  });
  mdbases.push(mdbase);
  return mdbase;
}

it("signs out through the SDK, never by closing the entry", async () => {
  const mdbase = await testMdbase("choosing");
  const actions = () =>
    mdbase.fixture.controls.observedActions().map((call) => call.action);
  render(<SdkApp mdbase={mdbase} />);
  fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(actions()).toContain("signOut"));
  expect(actions()).not.toContain("close");
});

it("offers sample tasks on the sign-in screen only", async () => {
  const choosing = await testMdbase("choosing");
  const { unmount } = render(<SdkApp mdbase={choosing} />);
  await screen.findByRole("button", { name: "Sign out" });
  expect(screen.queryByRole("button", { name: "Try sample tasks" })).toBeNull();
  unmount();

  render(<SdkApp mdbase={await testMdbase("signed_out")} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Try sample tasks" }),
  );
  expect(
    await screen.findByRole("button", { name: "Sample tasks" }),
  ).toBeTruthy();
});

it("opens the ready collection with the shared switcher in the header", async () => {
  const { container } = render(<SdkApp mdbase={await testMdbase("ready")} />);
  await waitFor(() =>
    expect(
      container.querySelector(
        ".planner-brand .planner-collection-switcher .mdbase-collections-trigger",
      ),
    ).toBeTruthy(),
  );
});
