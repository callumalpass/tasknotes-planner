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
  statusLabel: "Open",
  statusColor: "#64748b",
  priorityLabel: "High",
  priorityColor: "#ef4444",
  statusOptions: [
    {
      value: "open",
      label: "Open",
      color: "#64748b",
      order: 1,
      isCompleted: false,
      isSkipped: false,
    },
    {
      value: "done",
      label: "Done",
      color: "#22c55e",
      order: 2,
      isCompleted: true,
      isSkipped: false,
    },
  ],
  priorityOptions: [
    { value: "high", label: "High", color: "#ef4444", weight: 3 },
    { value: "normal", label: "Normal", color: "#f59e0b", weight: 2 },
  ],
};

describe("TaskInspector", () => {
  it("writes configured TaskNotes status and priority values", async () => {
    const onSaveProperties = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskInspector
        allTasks={[task]}
        task={task}
        onClose={() => undefined}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onSaveDependencies={vi.fn().mockResolvedValue(undefined)}
        onSaveProperties={onSaveProperties}
      />,
    );
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "done" },
    });
    await waitFor(() =>
      expect(onSaveProperties).toHaveBeenCalledWith(task, { status: "done" }),
    );
    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "normal" },
    });
    await waitFor(() =>
      expect(onSaveProperties).toHaveBeenCalledWith(task, {
        priority: "normal",
      }),
    );
  });

  it("adds and clears TaskNotes project memberships", async () => {
    const launch = {
      ...task,
      id: "launch",
      path: "tasks/launch.md",
      title: "Launch task",
      projects: ["[[Launch]]"],
    };
    const onSaveProperties = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskInspector
        allTasks={[task, launch]}
        task={task}
        onClose={() => undefined}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onSaveDependencies={vi.fn().mockResolvedValue(undefined)}
        onSaveProperties={onSaveProperties}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: /Product planning/ }),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Launch" }));
    await waitFor(() =>
      expect(onSaveProperties).toHaveBeenCalledWith(task, {
        projects: ["[[Product planning]]", "[[Launch]]"],
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Use Launch as planning group" }),
    );
    await waitFor(() =>
      expect(onSaveProperties).toHaveBeenLastCalledWith(task, {
        projects: ["[[Launch]]", "[[Product planning]]"],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Move to Unassigned" }));
    await waitFor(() =>
      expect(onSaveProperties).toHaveBeenLastCalledWith(task, { projects: [] }),
    );
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("saves canonical date-only schedule values", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onSaveDependencies = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskInspector
        allTasks={[task]}
        task={task}
        onClose={() => undefined}
        onSave={onSave}
        onSaveDependencies={onSaveDependencies}
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
    const onSaveDependencies = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskInspector
        allTasks={[task]}
        task={task}
        onClose={() => undefined}
        onSave={onSave}
        onSaveDependencies={onSaveDependencies}
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

  it("adds a selected blocking relationship", async () => {
    const research: PlannerTask = {
      ...task,
      id: "research",
      path: "tasks/research.md",
      title: "Research options",
      blockedBy: [],
    };
    const target = { ...task, blockedBy: [] };
    const onSaveDependencies = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskInspector
        allTasks={[research, target]}
        task={target}
        onClose={() => undefined}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onSaveDependencies={onSaveDependencies}
      />,
    );
    fireEvent.change(screen.getByLabelText("Blocking task"), {
      target: { value: "research" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add relationship" }));
    await waitFor(() =>
      expect(onSaveDependencies).toHaveBeenCalledWith(target, [
        { uid: "research", reltype: "FINISHTOSTART" },
      ]),
    );
  });

  it("adds intraday times using canonical TaskNotes timestamps", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <TaskInspector
        allTasks={[task]}
        task={task}
        onClose={() => undefined}
        onSave={onSave}
        onSaveDependencies={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByLabelText("Scheduled time"), {
      target: { value: "09:30" },
    });
    fireEvent.change(screen.getByLabelText("Due time"), {
      target: { value: "11:15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith(task, {
        scheduled: "2026-08-17T09:30:00",
        due: "2026-08-25T11:15:00",
      }),
    );
  });
});
