import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  MdbaseApplication,
  MdbaseApplicationSnapshot,
} from "@mdbase-dev/sdk";
import { SdkConnectionGate, type PlannerSdk } from "./sdk-connection-gate";
import { App } from "./app";

vi.mock("./connection-gate", () => {
  throw new Error(
    "Native Planner must not import/instantiate the legacy session",
  );
});

// Typed lifecycle stand-ins only; the actual SDK MemoryReplica/client→Planner
// integration is in planner.native.test.tsx. No production session substitute.
function fixture(initial: Partial<MdbaseApplicationSnapshot> = {}) {
  const facet = { checking: false, assessment: null, problem: null };
  let snapshot: MdbaseApplicationSnapshot = {
    status: "signed_out",
    signIn: null,
    collections: [],
    selectedCollectionId: null,
    problem: null,
    timing: null,
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
    ...initial,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<MdbaseApplicationSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const application: MdbaseApplication = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: vi.fn<MdbaseApplication["start"]>(async () => {
      publish({ status: "signed_out" });
      return snapshot;
    }),
    authorize: vi.fn<MdbaseApplication["authorize"]>(async () => {
      publish({ status: "authorizing" });
      return snapshot;
    }),
    select: vi.fn<MdbaseApplication["select"]>(async () => snapshot),
    clearSelection: vi.fn<MdbaseApplication["clearSelection"]>(
      async () => snapshot,
    ),
    forget: vi.fn<MdbaseApplication["forget"]>(async () => snapshot),
    setForeground: vi.fn<MdbaseApplication["setForeground"]>(),
    close: vi.fn<MdbaseApplication["close"]>(async () => {
      publish({ status: "closed" });
    }),
  };
  const sdk: PlannerSdk = {
    application: () => application,
    connection: vi.fn(() => null),
  };
  return { application, sdk, publish, listeners };
}

const paired: NonNullable<MdbaseApplicationSnapshot["signIn"]> = {
  requestId: "test-request",
  installationId: "test-installation",
  deviceId: "test-device",
  appId: "test-app",
  kind: "app-runtime",
  verificationUri: "https://mdbase.test/approve",
  state: "paired",
  accountId: "test-account",
  accountEmail: "planner@example.test",
  collectionIds: [],
  createCollections: false,
  requestedCreateCollections: false,
};
const collections: MdbaseApplicationSnapshot["collections"] = [
  { collectionId: "selected", displayName: "Selected work", role: "owner" },
  { collectionId: "other", displayName: "Other work", role: "editor" },
];
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Planner public application surface (typed UI stand-ins, not runtime acceptance)", () => {
  it("the native App entry never imports or instantiates the legacy session", () => {
    const h = fixture();
    render(<App sdk={h.sdk} />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(h.application.start).not.toHaveBeenCalled();
  });

  it("starts only the borrowed singleton and aborts caller/subscription on UI retirement", async () => {
    const h = fixture({ status: "not_started" });
    const view = render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    await waitFor(() => expect(h.application.start).toHaveBeenCalledOnce());
    const options = vi.mocked(h.application.start).mock.calls[0][0];
    expect(options?.signal?.aborted).toBe(false);
    expect(h.application.setForeground).toHaveBeenCalled();
    view.unmount();
    expect(options?.signal?.aborted).toBe(true);
    expect(h.listeners.size).toBe(0);
    expect(h.application.close).not.toHaveBeenCalled();
  });

  it("delegates authorize synchronously in the gesture, with no app window/popup/start sequence", () => {
    const h = fixture();
    const open = vi.spyOn(window, "open");
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(h.application.authorize).toHaveBeenCalledOnce();
    expect(h.application.start).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain(
      "Waiting for approval",
    );
  });

  it("selects only the original SDK collection ID, not its display name", async () => {
    const h = fixture({ status: "unselected", collections, signIn: paired });
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Other work" }));
    await waitFor(() =>
      expect(h.application.select).toHaveBeenCalledWith("other", {
        signal: expect.any(AbortSignal),
      }),
    );
    expect(screen.getByText("Signed in as planner@example.test")).toBeTruthy();
  });

  it("forgets the actual selected ID and delegates clearSelection separately", async () => {
    const h = fixture({
      status: "unselected",
      collections,
      selectedCollectionId: "selected",
      signIn: paired,
    });
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Forget collection" }));
    await waitFor(() =>
      expect(h.application.forget).toHaveBeenCalledWith("selected", {
        signal: expect.any(AbortSignal),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Choose another collection" }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Choose another collection" }),
    );
    expect(h.application.clearSelection).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(h.application.close).not.toHaveBeenCalled();
  });

  it("cannot publish signout before successful physical close", async () => {
    const h = fixture({ status: "unselected", signIn: paired });
    let finish!: () => void;
    vi.mocked(h.application.close).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const signedOut = vi.fn();
    render(
      <SdkConnectionGate
        sdk={h.sdk}
        onDemo={vi.fn()}
        onSignedOut={signedOut}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signedOut).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(signedOut).toHaveBeenCalledOnce();
  });

  it("a rejected close retains original paired presentation and hides private rejection details", async () => {
    const h = fixture({ status: "unselected", signIn: paired });
    vi.mocked(h.application.close).mockRejectedValue(
      new Error("private-custody-diagnostic"),
    );
    const signedOut = vi.fn();
    render(
      <SdkConnectionGate
        sdk={h.sdk}
        onDemo={vi.fn()}
        onSignedOut={signedOut}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "could not open this collection",
    );
    expect(signedOut).not.toHaveBeenCalled();
    expect(screen.getByText("Signed in as planner@example.test")).toBeTruthy();
    expect(screen.queryByText("private-custody-diagnostic")).toBeNull();
  });

  it("fences a late original close when the UI owner is replaced", async () => {
    const original = fixture({ status: "unselected", signIn: paired });
    const replacement = fixture();
    let finish!: () => void;
    vi.mocked(original.application.close).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const signedOut = vi.fn();
    const view = render(
      <SdkConnectionGate
        sdk={original.sdk}
        onDemo={vi.fn()}
        onSignedOut={signedOut}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    view.rerender(
      <SdkConnectionGate
        sdk={replacement.sdk}
        onDemo={vi.fn()}
        onSignedOut={signedOut}
      />,
    );
    await act(async () => finish());
    expect(signedOut).not.toHaveBeenCalled();
    expect(original.listeners.size).toBe(0);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("does not display native IDs as identity when no canonical account label exists", () => {
    const h = fixture({
      status: "unselected",
      signIn: { ...paired, accountEmail: null },
    });
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    expect(screen.queryByText(/test-account/)).toBeNull();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it("uses the SDK's existing genuine canonical GitHub login without inventing an email", () => {
    const h = fixture({
      status: "unselected",
      signIn: {
        ...paired,
        accountEmail: null,
        accountProvider: "github",
        accountLogin: "planner-user",
      },
    });
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    expect(
      screen.getByText("Signed in as planner-user on GitHub"),
    ).toBeTruthy();
    expect(screen.queryByText(/test-account|planner-user@/)).toBeNull();
  });

  it("an unavailable shell cannot offer pretend sign-in, selection, setup or READY", () => {
    const h = fixture({
      status: "blocked",
      problem: "application_not_yet_available",
      collections,
    });
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "isn't available in this build",
    );
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Selected work" })).toBeNull();
    expect(h.sdk.connection).not.toHaveBeenCalled();
  });

  it("setup_required remains explicit with no app provision engine or fake ready transition", () => {
    const h = fixture({
      status: "setup_required",
      collections,
      selectedCollectionId: "selected",
      signIn: paired,
    });
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "needs TaskNotes setup",
    );
    expect(
      screen.getByRole("button", { name: "Choose another collection" }),
    ).toBeTruthy();
    expect(h.sdk.connection).not.toHaveBeenCalled();
  });

  it("ready transport with unknown semantic assessment or no usable connection cannot render a ledger", () => {
    const h = fixture({
      status: "ready",
      collections,
      selectedCollectionId: "selected",
    });
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    expect(h.sdk.connection).toHaveBeenCalledWith("selected");
    expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Opening Selected work",
    );
  });
});
