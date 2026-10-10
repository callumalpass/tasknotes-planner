import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppWebSignInSnapshot } from "@mdbase-dev/sdk/app-host";
import type { NativeSignInBinding } from "../data/native-signin-ui";
import { NativeSignIn } from "./native-signin";

afterEach(cleanup);

let key = 0;
function binding(initial: Partial<AppWebSignInSnapshot> = {}) {
  let snapshot: AppWebSignInSnapshot = {
    status: "signed_out",
    signIn: null,
    collections: [],
    selectedCollectionId: null,
    problem: null,
    timing: null,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<AppWebSignInSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener();
  };
  const result: NativeSignInBinding = {
    viewKey: ++key,
    portal: { reserve: vi.fn(), open: vi.fn(), cancel: vi.fn() },
    session: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      start: vi.fn(async () => snapshot),
      authorize: vi.fn(async () => {
        publish({ status: "authorizing" });
        return snapshot;
      }),
      renewExpiredPairing: vi.fn(async () => {
        publish({ problem: null });
        return snapshot;
      }),
      forget: vi.fn(async () => snapshot),
      close: vi.fn(async () => {
        publish({ status: "closed", signIn: null });
      }),
      setForeground: vi.fn(),
    },
  };
  return { result, publish };
}
const paired: NonNullable<AppWebSignInSnapshot["signIn"]> = {
  requestId: "request",
  installationId: "installation",
  deviceId: "device",
  appId: "app",
  kind: "app-runtime",
  verificationUri: "https://mdbase.test/approve",
  state: "paired",
  accountId: "account",
  accountEmail: "reader@example.test",
  collectionIds: [],
  createCollections: false,
  requestedCreateCollections: false,
};

describe("public SDK sign-in UI bindings (stand-ins, not native acceptance)", () => {
  it("one Sign in action reserves the tab and delegates authorization", async () => {
    const h = binding();
    render(<NativeSignIn binding={h.result} onSignedOut={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(h.result.session.authorize).toHaveBeenCalledOnce(),
    );
    expect(h.result.portal.reserve).toHaveBeenCalledOnce();
    expect(
      vi.mocked(h.result.portal.reserve).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(h.result.session.authorize).mock.invocationCallOrder[0],
    );
    expect(screen.getByRole("status").textContent).toBe(
      "Waiting for approval in the mdbase tab…",
    );
    expect(
      screen.getByRole("button", { name: "Open the mdbase tab again" }),
    ).toBeTruthy();
  });
  it("auto-detects the SDK's approval publication without an app polling action", async () => {
    const h = binding({ status: "authorizing" });
    render(<NativeSignIn binding={h.result} onSignedOut={vi.fn()} />);
    await act(async () => h.publish({ status: "unselected", signIn: paired }));
    expect(screen.getByText("Signed in as reader@example.test")).toBeTruthy();
    expect(
      screen.getByText(
        "Opening collections isn't available in this build yet.",
      ),
    ).toBeTruthy();
    expect(h.result.session.authorize).not.toHaveBeenCalled();
    expect(screen.queryByText(/Set up|Continue setup/)).toBeNull();
  });
  it("one expired retry reserves BEFORE asynchronous SDK renewal", async () => {
    const h = binding({ status: "blocked", problem: "expired" });
    render(<NativeSignIn binding={h.result} onSignedOut={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(h.result.session.authorize).toHaveBeenCalledOnce(),
    );
    expect(h.result.session.renewExpiredPairing).toHaveBeenCalledOnce();
    expect(
      vi.mocked(h.result.portal.reserve).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(h.result.session.renewExpiredPairing).mock
        .invocationCallOrder[0],
    );
  });
  it("rapid repeated clicks do not create another UI authorization attempt", async () => {
    const h = binding();
    let finish!: (value: AppWebSignInSnapshot) => void;
    vi.mocked(h.result.session.authorize).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<NativeSignIn binding={h.result} onSignedOut={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Sign in" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(h.result.session.authorize).toHaveBeenCalledOnce();
    await act(async () => finish(h.result.session.getSnapshot()));
  });
  it("publishes local sign-out only after SDK close completes", async () => {
    const h = binding({ status: "unselected", signIn: paired });
    let finish!: () => void;
    vi.mocked(h.result.session.close).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const onSignedOut = vi.fn();
    render(<NativeSignIn binding={h.result} onSignedOut={onSignedOut} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignedOut).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(onSignedOut).toHaveBeenCalledOnce();
  });
  it("a failed close cannot present sign-out or qualify a new owner", async () => {
    const h = binding({ status: "unselected", signIn: paired });
    vi.mocked(h.result.session.close).mockRejectedValue(
      new Error("private diagnostic"),
    );
    const onSignedOut = vi.fn();
    render(<NativeSignIn binding={h.result} onSignedOut={onSignedOut} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "Sign-in was interrupted. Please try again.",
      ),
    );
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(screen.queryByText("private diagnostic")).toBeNull();
  });
  it("forgets only the SDK's selected collection and closes no borrowed session on unmount", async () => {
    const h = binding({
      status: "unselected",
      signIn: paired,
      selectedCollectionId: "selected",
    });
    const view = render(
      <NativeSignIn binding={h.result} onSignedOut={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Forget collection" }));
    await waitFor(() =>
      expect(h.result.session.forget).toHaveBeenCalledWith("selected"),
    );
    view.unmount();
    expect(h.result.session.close).not.toHaveBeenCalled();
  });
});
