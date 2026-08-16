import { fireEvent, render, screen } from "@testing-library/react";

import { WelcomePreview } from "./connection-gate";

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
