import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MdbasePeopleClient,
  mdbaseError,
  toPlain,
  type MdbaseApplication,
  type MdbaseApplicationConnection,
  type MdbaseApplicationSnapshot,
  type MdbaseClient,
  type MdbaseSetupPlan,
} from "@mdbase-dev/sdk";
import { createApplicationFixture } from "@mdbase-dev/sdk/testing";
import manifest from "../generated-mdbase-app.json";
import { nativePlannerFixture } from "../test/native-planner-fixture";
import { SdkConnectionGate, type PlannerSdk } from "./sdk-connection-gate";
import { App } from "./app";

vi.mock("./connection-gate", () => {
  throw new Error(
    "Native Planner must not import/instantiate the legacy session",
  );
});

const publicFixtures: { close(): void }[] = [];

// Typed lifecycle stand-ins only; the actual SDK MemoryReplica/client→Planner
// integration is in planner.native.test.tsx. No production session substitute.
function fixture(
  initial: Partial<MdbaseApplicationSnapshot> = {},
  setup?: MdbaseApplication["setup"],
) {
  const facet = { checking: false, assessment: null, problem: null };
  let snapshot: MdbaseApplicationSnapshot = {
    status: "signed_out",
    signIn: null,
    collections: [],
    selectedCollectionId: null,
    problem: null,
    timing: null,
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
    ...initial,
  };
  // New setup/delete ports remain the original public fixture implementations,
  // not no-op methods added merely to satisfy the application type.
  const publicFixture = createApplicationFixture({
    declaration: {
      id: manifest.id,
      name: manifest.name,
      origin: new URL(manifest.homepage).origin,
      environment: "lab",
      manifest,
    },
    initialSnapshot: snapshot,
    connections: [],
  });
  publicFixtures.push(publicFixture.controls);
  const original = publicFixture.entry.application();
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<MdbaseApplicationSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const application: MdbaseApplication = {
    setup: setup ?? original.setup,
    deleteCollection: original.deleteCollection,
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
    approve: vi.fn<MdbaseApplication["approve"]>(async () => snapshot),
    reauthorize: vi.fn<MdbaseApplication["reauthorize"]>(async () => snapshot),
    chooseAnother: vi.fn<MdbaseApplication["chooseAnother"]>(
      async () => snapshot,
    ),
    clearSelection: vi.fn<MdbaseApplication["clearSelection"]>(
      async () => snapshot,
    ),
    forget: vi.fn<MdbaseApplication["forget"]>(async () => snapshot),
    assess: vi.fn<MdbaseApplication["assess"]>(async () => snapshot.readiness),
    configure: vi.fn<MdbaseApplication["configure"]>(async () => snapshot),
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
const clients: MdbaseClient[] = [];
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.close();
  for (const fixture of publicFixtures.splice(0)) fixture.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

async function readyFixture(title?: string) {
  const f = await nativePlannerFixture(title);
  clients.push(f.client);
  const ready = {
    checking: false,
    assessment: { status: "ready" as const, problem: null },
    problem: null,
  };
  const omitted = { checking: false, assessment: null, problem: null };
  const h = fixture({
    status: "ready",
    selectedCollectionId: f.client.hello.collection,
    collections: [
      {
        collectionId: f.client.hello.collection,
        displayName: "Native work",
        role: "owner",
      },
    ],
    readiness: {
      ...ready,
      facets: {
        capabilities: ready,
        contracts: ready,
        configuration: ready,
        files: omitted,
        people: omitted,
        notifications: omitted,
      },
    },
  });
  const metadata = vi.fn(async () => {
    throw new Error("UI must not infer people consent");
  });
  const connection: MdbaseApplicationConnection = {
    id: f.client.hello.collection,
    displayName: "Native work",
    scope: {
      account: "fixture-account",
      installation: "fixture-installation",
      collection: f.client.hello.collection,
    },
    generation: "fixture-generation",
    records: f.client,
    files: f.client.files,
    people: new MdbasePeopleClient(f.client, {
      collection: f.client.hello.collection,
      request: metadata,
      isCurrent: () => true,
    }),
    isCurrent: vi.fn(() => true),
  };
  vi.mocked(h.sdk.connection).mockImplementation((id) =>
    id === connection.id ? connection : null,
  );
  return { ...f, ...h, connection, metadata };
}

describe("Planner public application surface (typed UI stand-ins, not runtime acceptance)", () => {
  it("the native App entry never imports or instantiates the legacy session", () => {
    const h = fixture();
    render(<App sdk={h.sdk} />);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(h.application.start).not.toHaveBeenCalled();
  });

  it("StrictMode startup replays UI effects without a second start or SDK close", async () => {
    const h = fixture({ status: "not_started" });
    const view = render(
      <StrictMode>
        <SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />
      </StrictMode>,
    );
    await waitFor(() => expect(h.application.start).toHaveBeenCalledOnce());
    expect(h.application.close).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(1);
    view.unmount();
    expect(h.listeners.size).toBe(0);
    expect(h.application.setForeground).toHaveBeenLastCalledWith(false);
    expect(h.application.close).not.toHaveBeenCalled();
  });

  it("renders and edits through the SAME SDK testing client under StrictMode, without accessor consent expansion", async () => {
    const h = await readyFixture();
    const close = vi.spyOn(h.client, "close");
    const update = vi.spyOn(h.client, "update");
    const get = vi.spyOn(h.client, "get");
    const watchChanges = vi.spyOn(h.client, "watchChanges");
    const view = render(
      <StrictMode>
        <SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />
      </StrictMode>,
    );
    const complete = await screen.findByRole("button", {
      name: "Complete Plan the SDK port",
    });
    expect(screen.getByRole("button", { name: /Native work/ })).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    expect(h.metadata).not.toHaveBeenCalled();
    fireEvent.click(complete);
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    await waitFor(async () => {
      const saved = await h.client.get(h.record.id, { effective: true });
      const status = saved.frontmatter.get("status");
      if (status === undefined)
        throw new Error("Confirmed task lost its status");
      expect(toPlain(status)).toBe("done");
      expect(saved.state.state).toBe("confirmed");
    });
    const watch = watchChanges.mock.results.find(
      (result) => result.type === "return",
    )?.value;
    expect(watch?.state).toBe("active");
    view.unmount();
    expect(watch?.state).toBe("closed");
    expect(close).not.toHaveBeenCalled();
    expect(h.application.close).not.toHaveBeenCalled();
    expect(h.metadata).not.toHaveBeenCalled();
  });

  it("semantic demotion unmounts the ledger and releases its original watch, not the SDK client", async () => {
    const h = await readyFixture();
    const close = vi.spyOn(h.client, "close");
    const watchChanges = vi.spyOn(h.client, "watchChanges");
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    await screen.findByRole("button", { name: "Complete Plan the SDK port" });
    const watch = watchChanges.mock.results.find(
      (result) => result.type === "return",
    )?.value;
    await act(async () =>
      h.publish({
        readiness: {
          ...h.application.getSnapshot().readiness,
          checking: true,
          assessment: null,
        },
      }),
    );
    expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Opening Native work");
    expect(watch?.state).toBe("closed");
    expect(close).not.toHaveBeenCalled();
    expect(h.application.close).not.toHaveBeenCalled();
  });

  it.each(["unknown", "checking", "incompatible", "setup_required"] as const)(
    "does not allocate a repository or read records when SDK readiness is %s",
    async (state) => {
      const h = await readyFixture();
      const initial = h.application.getSnapshot().readiness;
      h.publish({
        readiness: {
          ...initial,
          checking: state === "checking",
          assessment:
            state === "unknown" || state === "checking"
              ? null
              : { status: state, problem: null },
        },
      });
      render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
      await act(async () => undefined);
      expect(h.client.describe).not.toHaveBeenCalled();
      expect(h.client.listAppBasesViews).not.toHaveBeenCalled();
      expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
    },
  );

  it.each([
    "readiness problem",
    "assessment problem",
    "incompatible",
    "unknown",
  ] as const)(
    "settled %s offers an SDK recovery action instead of endless Opening",
    async (state) => {
      const h = await readyFixture();
      const initial = h.application.getSnapshot().readiness;
      const problem = { code: "private-readiness-diagnostic" };
      h.publish({
        readiness: {
          ...initial,
          assessment:
            state === "unknown"
              ? null
              : {
                  status: state === "incompatible" ? "incompatible" : "ready",
                  problem: state === "assessment problem" ? problem : null,
                },
          problem: state === "readiness problem" ? problem : null,
        },
      });
      render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
      await act(async () => undefined);
      expect(screen.queryByText(/Opening Native work/)).toBeNull();
      expect(screen.queryByText(/private-readiness-diagnostic/)).toBeNull();
      expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
      expect(h.client.describe).not.toHaveBeenCalled();
      expect(h.client.listAppBasesViews).not.toHaveBeenCalled();
      if (state === "incompatible") {
        expect(
          screen.getByRole("heading", {
            name: "This collection isn't compatible",
          }),
        ).toBeVisible();
        expect(screen.getByRole("alert")).toHaveTextContent("Update the app");
        expect(
          screen.getByRole("link", { name: "Update the app" }),
        ).toHaveAttribute("href", expect.stringMatching(/^https:\/\//));
        fireEvent.click(
          screen.getByRole("button", { name: "Choose another collection" }),
        );
        await waitFor(() =>
          expect(h.application.chooseAnother).toHaveBeenCalledOnce(),
        );
        expect(h.application.assess).not.toHaveBeenCalled();
      } else {
        fireEvent.click(screen.getByRole("button", { name: "Check again" }));
        await waitFor(() =>
          expect(h.application.assess).toHaveBeenCalledOnce(),
        );
        expect(
          vi.mocked(h.application.assess).mock.calls[0]?.[0]?.signal,
        ).toBeInstanceOf(AbortSignal);
      }
      expect(h.application.configure).not.toHaveBeenCalled();
      expect(h.application.close).not.toHaveBeenCalled();
    },
  );

  it("a retired connection cannot retain the ledger merely because its old readiness says ready", async () => {
    const h = await readyFixture();
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    await screen.findByRole("button", { name: "Complete Plan the SDK port" });
    vi.mocked(h.connection.isCurrent).mockReturnValue(false);
    await act(async () => h.publish({}));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "connection to this collection has changed",
    );
    expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Complete Plan the SDK port" }),
    ).toBeNull();
  });

  it("refuses a public facade whose records client belongs to another collection", async () => {
    const h = await readyFixture();
    const selectedId = "other-collection";
    h.publish({
      selectedCollectionId: selectedId,
      collections: [
        {
          collectionId: selectedId,
          displayName: "Wrong client",
          role: "owner",
        },
      ],
    });
    vi.mocked(h.sdk.connection).mockReturnValue({
      ...h.connection,
      id: selectedId,
    });
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    await act(async () => undefined);
    expect(h.client.describe).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Timeline" })).toBeNull();
  });

  it("late old-client catalog delivery cannot populate the replacement collection", async () => {
    const original = await readyFixture("Old task must not return");
    const replacement = await readyFixture("Current replacement task");
    let release!: (catalog: typeof original.catalog) => void;
    vi.mocked(original.client.describe).mockReturnValue(
      new Promise<typeof original.catalog>((resolve) => {
        release = resolve;
      }),
    );
    vi.mocked(original.sdk.connection).mockImplementation((id) =>
      id === original.connection.id
        ? original.connection
        : id === replacement.connection.id
          ? replacement.connection
          : null,
    );
    const close = vi.spyOn(original.client, "close");
    render(<SdkConnectionGate sdk={original.sdk} onDemo={vi.fn()} />);
    await waitFor(() => expect(original.client.describe).toHaveBeenCalled());
    const describeArg = vi.mocked(original.client.describe).mock.calls[0][0];
    const originalSignal =
      describeArg instanceof AbortSignal ? describeArg : describeArg?.signal;
    await act(async () =>
      original.publish({
        selectedCollectionId: replacement.connection.id,
        collections: [
          {
            collectionId: replacement.connection.id,
            displayName: "Replacement",
            role: "owner",
          },
        ],
      }),
    );
    await screen.findByRole("button", {
      name: "Complete Current replacement task",
    });
    expect(originalSignal?.aborted).toBe(true);
    await act(async () => release(original.catalog));
    expect(screen.queryByText("Old task must not return")).toBeNull();
    expect(screen.getByRole("button", { name: /Replacement/ })).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
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

  it("forgets the actual selected ID and delegates chooseAnother separately", async () => {
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
    expect(h.application.chooseAnother).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
    });
    expect(h.application.close).not.toHaveBeenCalled();
  });

  it("offers approval or another collection for an unapproved link, never a fallback", async () => {
    const h = fixture({
      status: "unselected",
      signIn: paired,
      selection: {
        state: "approval_required",
        requested: {
          collectionId: "linked",
          source: "url",
          displayName: null,
          approved: false,
        },
        usable: null,
        problem: null,
      },
    });
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    expect(screen.getByText(/isn't approved for the collection/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Approve this collection" }),
    );
    await waitFor(() =>
      expect(h.application.approve).toHaveBeenCalledWith(undefined, {
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
    expect(h.application.chooseAnother).toHaveBeenCalled();
    expect(h.application.select).not.toHaveBeenCalled();
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

  it("a blocked open shows the SDK's title, copy and one action, never a raw code or endless Opening", async () => {
    const h = fixture({
      status: "blocked",
      problem: "unauthenticated",
      collections,
      selectedCollectionId: "selected",
    });
    const view = render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    expect(
      screen.getByRole("heading", { name: "Sign in again" }),
    ).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your session has ended",
    );
    expect(screen.queryByText(/Opening/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(h.application.authorize).toHaveBeenCalledOnce());
    view.unmount();

    const unknown = fixture({
      status: "blocked",
      problem: "private-open-diagnostic",
      collections,
      selectedCollectionId: "selected",
    });
    render(<SdkConnectionGate sdk={unknown.sdk} onDemo={vi.fn()} />);
    expect(screen.queryByText(/private-open-diagnostic/)).toBeNull();
    expect(screen.queryByText(/Opening/)).toBeNull();
    expect(screen.getByRole("heading", { level: 2 })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Try again|Reload/ }),
    ).toBeVisible();
  });

  const setupPlan: MdbaseSetupPlan = {
    status: "setup",
    canApply: true,
    digest: `sha256:${"a".repeat(64)}`,
    summary: "This app will make 2 changes to this collection.",
    changes: [
      {
        kind: "create",
        target: "_types/task.md",
        message: 'Add the "task" record type.',
      },
      {
        kind: "setting",
        target: "record extensions",
        message: 'Add "base" to the collection\'s record extensions setting.',
      },
    ],
    conflicts: [],
    adoptable: {},
    packs: [],
    staged: [],
    records: [],
  };
  function setupFixture(apply: MdbaseApplication["setup"]["apply"]) {
    const setup = {
      plan: vi.fn<MdbaseApplication["setup"]["plan"]>(async () => setupPlan),
      apply: vi.fn(apply),
    };
    const h = fixture(
      {
        status: "setup_required",
        collections,
        selectedCollectionId: "selected",
        signIn: paired,
      },
      setup,
    );
    render(<SdkConnectionGate sdk={h.sdk} onDemo={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "needs TaskNotes setup",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Set up TaskNotes Planner" }),
    );
    return { ...h, setup };
  }

  it("setup shows the SDK's review and writes nothing until Confirm applies that exact plan", async () => {
    const h = setupFixture(async () => h.application.getSnapshot());
    expect(await screen.findByText(setupPlan.summary)).toBeVisible();
    expect(screen.getByText('Add the "task" record type.')).toBeVisible();
    expect(screen.getByText(/record extensions setting/)).toBeVisible();
    expect(h.setup.apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(h.setup.apply).toHaveBeenCalledOnce());
    expect(h.setup.apply.mock.calls[0]?.[0]).toBe(setupPlan);
    expect(h.setup.apply.mock.calls[0]?.[1]?.signal).toBeInstanceOf(
      AbortSignal,
    );
    expect(h.application.configure).not.toHaveBeenCalled();
    // Applying never invents readiness; the ledger still waits for the SDK.
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "needs TaskNotes setup",
      ),
    );
    expect(h.sdk.connection).not.toHaveBeenCalled();
  });

  it("a collection that changed during review is planned again, never applied blind", async () => {
    const h = setupFixture(async () => {
      throw mdbaseError("conflict", "changed", "setup_changed");
    });
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(
      await screen.findByText(/changed while you were reviewing/),
    ).toBeVisible();
    expect(h.setup.plan).toHaveBeenCalledTimes(2);
    expect(h.setup.apply).toHaveBeenCalledOnce();
    expect(
      await screen.findByRole("button", { name: "Confirm" }),
    ).toBeEnabled();
  });

  it("Cancel leaves the collection untouched", async () => {
    const h = setupFixture(async () => h.application.getSnapshot());
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Set up TaskNotes Planner" }),
    ).toBeVisible();
    expect(h.setup.apply).not.toHaveBeenCalled();
    expect(h.application.configure).not.toHaveBeenCalled();
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
      "hasn't been checked yet",
    );
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });
});
