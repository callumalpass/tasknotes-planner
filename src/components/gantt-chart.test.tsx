import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { GanttChart } from "./gantt-chart";

import type { PlannerTask } from "../domain/task";

const makeTask = (input: Partial<PlannerTask>): PlannerTask => ({
  id: input.id ?? "task",
  path: input.path ?? `tasks/${input.id ?? "task"}.md`,
  title: input.title ?? "Task",
  status: input.status ?? "open",
  priority: input.priority ?? "normal",
  projects: input.projects ?? [],
  blockedBy: input.blockedBy ?? [],
  completed: input.completed ?? false,
  statusLabel: input.statusLabel ?? input.status ?? "Open",
  statusColor: input.statusColor ?? "#64748b",
  priorityLabel: input.priorityLabel ?? input.priority ?? "Normal",
  priorityColor: input.priorityColor ?? "#f59e0b",
  statusOptions: input.statusOptions ?? [],
  priorityOptions: input.priorityOptions ?? [],
  ...input,
});

beforeEach(() => {
  globalThis.PointerEvent = MouseEvent as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollTo = vi.fn();
});

describe("GanttChart interactions", () => {
  it("places an unscheduled task on the timeline by dragging", async () => {
    const task = makeTask({ id: "unscheduled", title: "Unscheduled" });
    const onScheduleChange = vi.fn().mockResolvedValue(undefined);
    render(
      <GanttChart
        allTasks={[task]}
        selectedId={null}
        tasks={[task]}
        todayRequest={0}
        zoom={3}
        onDependenciesChange={vi.fn().mockResolvedValue(undefined)}
        onScheduleChange={onScheduleChange}
        onSelect={() => undefined}
        onZoom={() => undefined}
      />,
    );

    const handle = screen.getByRole("button", { name: "Drag to schedule" });
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 360,
      pointerId: 1,
    });
    fireEvent.pointerMove(handle, { clientX: 420, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 420, pointerId: 1 });

    await waitFor(() => expect(onScheduleChange).toHaveBeenCalledOnce());
    expect(onScheduleChange.mock.calls[0][0]).toBe(task);
    expect(onScheduleChange.mock.calls[0][1]).toEqual({
      due: undefined,
      scheduled: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("places unscheduled work at an explicit intraday time", async () => {
    const task = makeTask({ id: "intraday", title: "Intraday" });
    const onScheduleChange = vi.fn().mockResolvedValue(undefined);
    render(
      <GanttChart
        allTasks={[task]}
        selectedId={null}
        tasks={[task]}
        todayRequest={0}
        zoom={7}
        onDependenciesChange={vi.fn().mockResolvedValue(undefined)}
        onScheduleChange={onScheduleChange}
        onSelect={() => undefined}
        onZoom={() => undefined}
      />,
    );

    const handle = screen.getByRole("button", { name: "Drag to schedule" });
    fireEvent.pointerDown(handle, {
      button: 0,
      clientX: 360,
      pointerId: 4,
    });
    fireEvent.pointerMove(handle, { clientX: 420, pointerId: 4 });
    fireEvent.pointerUp(handle, { clientX: 420, pointerId: 4 });

    await waitFor(() => expect(onScheduleChange).toHaveBeenCalledOnce());
    expect(onScheduleChange.mock.calls[0][1]).toEqual({
      due: undefined,
      scheduled: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:(00|15|30|45):00$/,
      ),
    });
  });

  it("draws an edge relationship and stores it on the target", async () => {
    const source = makeTask({
      id: "source",
      title: "Source",
      scheduled: "2026-08-17",
      due: "2026-08-19",
    });
    const target = makeTask({
      id: "target",
      title: "Target",
      scheduled: "2026-08-20",
      due: "2026-08-22",
    });
    const onDependenciesChange = vi.fn().mockResolvedValue(undefined);
    render(
      <GanttChart
        allTasks={[source, target]}
        selectedId={null}
        tasks={[source, target]}
        todayRequest={0}
        zoom={3}
        onDependenciesChange={onDependenciesChange}
        onScheduleChange={vi.fn().mockResolvedValue(undefined)}
        onSelect={() => undefined}
        onZoom={() => undefined}
      />,
    );

    const sourceHandle = screen.getByRole("button", {
      name: "Finish relationship handle for Source",
    });
    const targetHandle = screen.getByRole("button", {
      name: "Start relationship handle for Target",
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => targetHandle),
    });

    fireEvent.pointerDown(sourceHandle, {
      button: 0,
      clientX: 600,
      clientY: 100,
      pointerId: 2,
    });
    fireEvent.pointerMove(sourceHandle, {
      clientX: 650,
      clientY: 150,
      pointerId: 2,
    });
    fireEvent.pointerUp(sourceHandle, {
      clientX: 650,
      clientY: 150,
      pointerId: 2,
    });

    await waitFor(() => expect(onDependenciesChange).toHaveBeenCalledOnce());
    expect(onDependenciesChange).toHaveBeenCalledWith(target, [
      { uid: "source", reltype: "FINISHTOSTART" },
    ]);
  });

  it("moves timed tasks in quarter-hour increments at the closest scale", async () => {
    const task = makeTask({
      id: "timed",
      title: "Timed task",
      scheduled: "2026-08-17T09:30:00",
      due: "2026-08-17T10:30:00",
    });
    const onScheduleChange = vi.fn().mockResolvedValue(undefined);
    render(
      <GanttChart
        allTasks={[task]}
        selectedId={null}
        tasks={[task]}
        todayRequest={0}
        zoom={7}
        onDependenciesChange={vi.fn().mockResolvedValue(undefined)}
        onScheduleChange={onScheduleChange}
        onSelect={() => undefined}
        onZoom={() => undefined}
      />,
    );

    const bar = screen.getByRole("button", { name: /Timed task, .*09:30/ });
    fireEvent.pointerDown(bar, {
      button: 0,
      clientX: 600,
      pointerId: 3,
    });
    fireEvent.pointerMove(bar, { clientX: 624, pointerId: 3 });
    fireEvent.pointerUp(bar, { clientX: 624, pointerId: 3 });

    await waitFor(() =>
      expect(onScheduleChange).toHaveBeenCalledWith(task, {
        scheduled: "2026-08-17T10:30:00",
        due: "2026-08-17T11:30:00",
      }),
    );
  });
});
