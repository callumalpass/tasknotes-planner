import { fireEvent, render, screen } from "@testing-library/react";

import type { MdbaseApplicationSessionSnapshot } from "@mdbase-dev/connect";

import { SetupReview, WelcomePreview } from "./connection-gate";

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
