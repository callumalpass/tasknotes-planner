import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Mdbase } from "@mdbase-dev/sdk";

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

const collection = {
  collectionId: "c1",
  displayName: "Launch plan",
  role: "owner",
};

function fakeMdbase(phase: Record<string, unknown>, signedIn = true) {
  const snapshot = {
    status: "ready",
    collections: signedIn ? [collection] : [],
    signIn: signedIn
      ? { state: "paired", accountEmail: "me@example.com" }
      : null,
    selection: {
      state: "usable",
      lastApproval: null,
      requested: { collectionId: null, displayName: null },
    },
    readiness: {},
    links: null,
    phase,
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    start: vi.fn(async () => snapshot),
    close: vi.fn(async () => undefined),
    signOut: vi.fn(async () => snapshot),
    chooseAnother: vi.fn(async () => snapshot),
  };
}

it("signs out through the SDK, never by closing the entry", async () => {
  const mdbase = fakeMdbase({ kind: "choosing", lastApproval: null });
  render(<SdkApp mdbase={mdbase as unknown as Mdbase} />);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() => expect(mdbase.signOut).toHaveBeenCalledOnce());
  expect(mdbase.close).not.toHaveBeenCalled();
});

it("offers sample tasks before sign-in", async () => {
  const mdbase = fakeMdbase({ kind: "signed_out", notice: null }, false);
  render(<SdkApp mdbase={mdbase as unknown as Mdbase} />);
  fireEvent.click(screen.getByRole("button", { name: "Try sample tasks" }));
  expect(
    await screen.findByRole("button", { name: "Sample tasks" }),
  ).toBeTruthy();
});

it("opens the ready collection with the shared switcher in the header", async () => {
  const mdbase = fakeMdbase({
    kind: "ready",
    collectionId: "c1",
    collection,
    connection: {
      id: "c1",
      displayName: "Launch plan",
      generation: "c1-1",
      records: {},
      isCurrent: () => true,
    },
    problem: null,
  });
  const { container } = render(<SdkApp mdbase={mdbase as unknown as Mdbase} />);
  await waitFor(() =>
    expect(
      container.querySelector(
        ".planner-brand .planner-collection-switcher .mdbase-collections-trigger",
      ),
    ).toBeTruthy(),
  );
  expect(mdbase.start).toHaveBeenCalledOnce();
});
