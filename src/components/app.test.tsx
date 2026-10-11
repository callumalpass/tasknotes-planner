import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./app";

// Only the connection-screen boundary is a UI stand-in. The existing sample
// repository and Planner renderer are real; no legacy session/snapshot fixture.
vi.mock("./connection-gate", () => ({
  ConnectionGate: ({ onDemo }: { onDemo(): void }) => (
    <button onClick={onDemo}>Use sample tasks</button>
  ),
}));

const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  HTMLElement.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  history.replaceState(null, "", "/");
});

describe("first-run sample plan navigation", () => {
  it("labels the real sample and preserves unrelated URL state when leaving a demo link", async () => {
    history.replaceState(
      { original: true },
      "",
      "/?demo=1&keep=original#context",
    );
    const view = render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Sample tasks" }),
    );
    expect(
      await screen.findByRole("button", { name: "Use sample tasks" }),
    ).toBeTruthy();
    expect(new URL(location.href).searchParams.has("demo")).toBe(false);
    expect(new URL(location.href).searchParams.get("keep")).toBe("original");
    expect(location.hash).toBe("#context");
    expect(history.state).toEqual({ original: true });
    view.unmount();
    render(<App />);
    expect(
      await screen.findByRole("button", { name: "Use sample tasks" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sample tasks" })).toBeNull();
  });
  it("can enter and leave samples from the ordinary first-run action", async () => {
    history.replaceState(null, "", "/?keep=original");
    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Use sample tasks" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Sample tasks" }),
    );
    expect(
      await screen.findByRole("button", { name: "Use sample tasks" }),
    ).toBeTruthy();
    expect(location.search).toBe("?keep=original");
  });
});
