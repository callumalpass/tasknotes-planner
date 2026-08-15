import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TaskInspector } from "./task-inspector";

import type { PlannerTask } from "../domain/task";

const task: PlannerTask = {
  id: "prototype",
  path: "tasks/prototype.md",
  title: "Build prototype",
  status: "open",
  priority: "high",
  scheduled: "2026-08-17",
  due: "2026-08-25",
  projects: ["[[Product planning]]"],
  blockedBy: [{ uid: "research", reltype: "FINISHTOSTART" }],
  completed: false,
};

describe("TaskInspector", () => {
  it("saves canonical date-only schedule values", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskInspector
        allTasks={[task]}
        task={task}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Scheduled"), {
      target: { value: "2026-08-19" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(task, {
        scheduled: "2026-08-19",
        due: "2026-08-25",
      }),
    );
  });

  it("does not save a reverse date range", () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskInspector
        allTasks={[task]}
        task={task}
        onClose={() => undefined}
        onSave={onSave}
      />,
    );
    fireEvent.change(screen.getByLabelText("Scheduled"), {
      target: { value: "2026-08-30" },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Due date must be on or after the scheduled date.",
    );
    expect(
      screen.getByRole("button", { name: "Save schedule" }),
    ).toBeDisabled();
  });
});
