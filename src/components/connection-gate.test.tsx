import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { MdbaseApplicationSessionSnapshot } from "@mdbase-dev/connect";

const connectMock = vi.hoisted(() => {
  const ok = <Value,>(value: Value) => ({
    ok: true as const,
    value,
    diagnostics: [],
  });
  let snapshot: MdbaseApplicationSessionSnapshot = {
    status: "unselected",
    connections: [],
  };
  const listeners = new Set<() => void>();
  const isAuthorizationCallback = vi.fn(() => false);
  const session = {
    applyCollectionSetup: vi.fn(),
    authorize: vi.fn(),
    clearSelection: vi.fn(),
    connection: vi.fn(() => null),
    getSnapshot: vi.fn(() => snapshot),
    handleAuthorizationCallback: vi.fn(),
    select: vi.fn(),
    start: vi.fn(),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return {
    session,
    isAuthorizationCallback,
    reset() {
      snapshot = { status: "unselected", connections: [] };
      listeners.clear();
      for (const mock of Object.values(session)) {
        if ("mockReset" in mock) mock.mockReset();
      }
      session.connection.mockReturnValue(null);
      session.start.mockResolvedValue(ok(snapshot));
      session.authorize.mockResolvedValue(ok({ kind: "redirected" }));
      session.applyCollectionSetup.mockResolvedValue(ok(snapshot));
      session.handleAuthorizationCallback.mockResolvedValue(ok({}));
      session.select.mockReturnValue(ok({}));
      session.clearSelection.mockReturnValue(ok(undefined));
      isAuthorizationCallback.mockReset();
      isAuthorizationCallback.mockReturnValue(false);
    },
    setSnapshot(next: MdbaseApplicationSessionSnapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock("../data/connect", () => ({
  assertPlannerOrigin: vi.fn(),
  isAuthorizationCallback: connectMock.isAuthorizationCallback,
  plannerSession: connectMock.session,
}));

import { SetupReview, WelcomePreview } from "./connection-gate";

beforeEach(() => connectMock.reset());

describe("ConnectionGate lifecycle", () => {
  it("retries a failed explicit start and gates collection actions", async () => {
    connectMock.session.start
      .mockImplementationOnce(async () => {
        const problem = {
          code: "temporarily_unavailable",
          message: "Connect is temporarily unavailable.",
        };
        connectMock.setSnapshot({
          status: "start_failed",
          problem,
          connections: [],
        } as unknown as MdbaseApplicationSessionSnapshot);
        return { ok: false as const, problem, diagnostics: [] };
      })
      .mockImplementationOnce(async () => {
        const snapshot: MdbaseApplicationSessionSnapshot = {
          status: "unselected",
          connections: [],
        };
        connectMock.setSnapshot(snapshot);
        return { ok: true as const, value: snapshot, diagnostics: [] };
      });

    const { ConnectionGate } = await import("./connection-gate");
    render(<ConnectionGate onDemo={vi.fn()} />);

    expect(
      await screen.findByRole("button", { name: "Retry opening Planner" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open collection" }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry opening Planner" }),
    );

    await screen.findByRole("button", { name: "Open collection" });
    expect(connectMock.session.start).toHaveBeenCalledTimes(2);
  });

  it("makes an abandoned startup timeout retryable from not_started", async () => {
    connectMock.session.start
      .mockImplementationOnce(async () => {
        connectMock.setSnapshot({ status: "starting", connections: [] });
        await Promise.resolve();
        connectMock.setSnapshot({ status: "not_started", connections: [] });
        return {
          ok: false as const,
          problem: { code: "timeout", message: "Startup timed out." },
        };
      })
      .mockImplementationOnce(async () => {
        const snapshot: MdbaseApplicationSessionSnapshot = {
          status: "unselected",
          connections: [],
        };
        connectMock.setSnapshot(snapshot);
        return { ok: true as const, value: snapshot, diagnostics: [] };
      });

    const { ConnectionGate } = await import("./connection-gate");
    render(<ConnectionGate onDemo={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Retry opening Planner" }),
    );
    await screen.findByRole("button", { name: "Open collection" });

    expect(connectMock.session.start).toHaveBeenNthCalledWith(1, {
      timeoutMs: 20_000,
    });
    expect(connectMock.session.start).toHaveBeenCalledTimes(2);
  });

  it("lets startup own callback completion with the callback budget", async () => {
    connectMock.isAuthorizationCallback.mockReturnValue(true);
    const { ConnectionGate } = await import("./connection-gate");
    render(<ConnectionGate onDemo={vi.fn()} />);

    await waitFor(() =>
      expect(connectMock.session.start).toHaveBeenCalledWith({
        timeoutMs: 60_000,
      }),
    );
    expect(
      connectMock.session.handleAuthorizationCallback,
    ).not.toHaveBeenCalled();
  });

  it("reviews declaration changes through explicit selected authorization", async () => {
    connectMock.setSnapshot(authorizationRequiredSnapshot());
    const { ConnectionGate } = await import("./connection-gate");
    render(<ConnectionGate onDemo={vi.fn()} />);

    await screen.findByText(
      /previous grant will not be upgraded automatically/,
    );
    expect(connectMock.session.authorize).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", { name: "Review updated access" }),
    );

    await waitFor(() =>
      expect(connectMock.session.authorize).toHaveBeenCalledWith("selected", {
        timeoutMs: 60_000,
      }),
    );
  });

  it("shows denied consent without falling back or applying setup", async () => {
    connectMock.setSnapshot(authorizationRequiredSnapshot());
    connectMock.session.authorize.mockResolvedValue({
      ok: false,
      problem: { code: "access_denied", message: "Authorization denied." },
      diagnostics: [],
    });
    const { ConnectionGate } = await import("./connection-gate");
    render(<ConnectionGate onDemo={vi.fn()} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Review updated access" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Authorization denied.",
    );
    expect(connectMock.session.authorize).toHaveBeenCalledTimes(1);
    expect(connectMock.session.applyCollectionSetup).not.toHaveBeenCalled();
  });

  it("omits the selected unusable collection from alternatives", async () => {
    const selected = authorizationRequiredSnapshot();
    connectMock.setSnapshot({
      ...selected,
      connections: [
        selected.info,
        { ...selected.info, collectionId: "collection-2", displayName: "Home" },
      ],
    });
    const { ConnectionGate } = await import("./connection-gate");
    render(<ConnectionGate onDemo={vi.fn()} />);

    expect(
      await screen.findByRole("button", { name: "Open Home" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Open Product" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Home" }));
    expect(connectMock.session.select).toHaveBeenCalledWith("collection-2", {
      history: "replace",
    });
  });

  it("reauthorizes an unavailable selected collection in place", async () => {
    connectMock.setSnapshot({
      status: "unavailable",
      collectionId: "collection-1",
      reason: "invalid_stored_grant",
      connections: [],
    });
    const { ConnectionGate } = await import("./connection-gate");
    render(<ConnectionGate onDemo={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Review updated access" }),
    );

    await waitFor(() =>
      expect(connectMock.session.authorize).toHaveBeenCalledWith("selected", {
        timeoutMs: 60_000,
      }),
    );
  });

  it("keeps destroyed sessions terminal", async () => {
    connectMock.setSnapshot({ status: "destroyed", connections: [] });
    const { ConnectionGate } = await import("./connection-gate");
    render(<ConnectionGate onDemo={vi.fn()} />);

    expect(
      await screen.findByText(
        "This collection session has closed. Reload Planner to reconnect.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /open collection|retry opening/i }),
    ).not.toBeInTheDocument();
    expect(connectMock.session.start).not.toHaveBeenCalled();
  });
});

function authorizationRequiredSnapshot(): Extract<
  MdbaseApplicationSessionSnapshot,
  { status: "authorization_required" }
> {
  return {
    status: "authorization_required",
    collectionId: "collection-1",
    info: {
      collectionId: "collection-1",
      displayName: "Product",
      operations: [],
      scope: { kind: "collection" },
      authority: { kind: "connector", durability: "computer" },
      route: "relay",
      directAccess: "unavailable",
    },
    capabilities: {
      requiredAvailable: false,
      optionalAvailable: false,
      available: [],
      unavailable: [],
    },
    connections: [],
  } as unknown as Extract<
    MdbaseApplicationSessionSnapshot,
    { status: "authorization_required" }
  >;
}

describe("WelcomePreview", () => {
  it("moves example tasks with pointer dragging", () => {
    render(<WelcomePreview />);
    const task = screen.getByRole("button", { name: "Research: move task" });
    Object.defineProperty(task.parentElement, "getBoundingClientRect", {
      value: () => ({ width: 500 }),
    });

    fireEvent.pointerDown(task, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(task, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(task, { clientX: 200, pointerId: 1 });

    expect(task).toHaveStyle("--preview-start: 25");
  });

  it("moves example tasks with the keyboard", () => {
    render(<WelcomePreview />);
    const task = screen.getByRole("button", { name: "Release: move task" });

    fireEvent.keyDown(task, { key: "ArrowRight" });

    expect(task).toHaveStyle("--preview-start: 45");
  });
});

describe("SetupReview", () => {
  it("shows the reviewed collection changes without implying record changes", () => {
    const snapshot = {
      status: "setup_review_required",
      collectionId: "collection-1",
      info: {
        collectionId: "collection-1",
        displayName: "Product",
        operations: [],
        scope: { kind: "collection" },
        authority: { kind: "connector", durability: "computer" },
        route: "relay",
        directAccess: "unavailable",
      },
      capabilities: {
        requiredAvailable: true,
        optionalAvailable: true,
        available: [],
        unavailable: [],
      },
      connections: [],
      update: {
        status: "provision",
        applicable: true,
        assessmentDigest: "sha256:assessment",
        collectionRevision: "revision-1",
        provisionDigest: "sha256:provision",
        canApply: true,
        reason: "",
        configuration: [
          {
            requirement: "tasknotes-bases",
            path: "x-obsidian.bases.include",
            value: "TaskNotes/Views/**/*.base",
            action: "add",
          },
        ],
        typePacks: [
          {
            id: "tasknotes.task",
            name: "TaskNotes task",
            status: "install",
            applicable: true,
            assessmentDigest: "sha256:pack",
            desiredVersion: "0.3.0-rc.10",
            resources: [],
            contractSetups: [],
            canApply: true,
            reason: "",
          },
        ],
      },
    } as unknown as Extract<
      MdbaseApplicationSessionSnapshot,
      { status: "setup_review_required" }
    >;

    render(<SetupReview snapshot={snapshot} />);

    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByText("TaskNotes task")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Task records, custom types, and unrelated collection settings will stay as they are.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("TaskNotes/Views/**/*.base")).toBeInTheDocument();
  });
});
