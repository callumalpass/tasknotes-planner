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
  // jsdom has no layout; give the calendar's scroller a viewport so its hit
  // testing (which ignores points outside the chart) has bounds.
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      return this.classList.contains("tnc-tl-scroll")
        ? ({
            left: 0,
            top: 0,
            right: 1200,
            bottom: 900,
            width: 1200,
            height: 900,
          } as DOMRect)
        : rect.call(this);
    },
  );
});

function renderChart(
  tasks: PlannerTask[],
  overrides: Partial<Parameters<typeof GanttChart>[0]> = {},
) {
  const props = {
    allTasks: tasks,
    tasks,
    selectedId: null,
    todayRequest: 0,
    zoom: 3,
    onSelect: vi.fn(),
    onZoom: vi.fn(),
    onScheduleChange: vi.fn().mockResolvedValue(undefined),
    onDependenciesChange: vi.fn().mockResolvedValue(undefined),
    onCompletionChange: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(<GanttChart {...props} />);
  return { ...props, view };
}

/** The calendar rows start at y = 0 in jsdom; row 0 is the project group. */
const TASK_ROW_Y = 49 + 10;

function bar(id: string) {
  return document.querySelector<HTMLElement>(`.tnc-item[data-id="${id}"]`)!;
}

function drag(
  element: Element,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  fireEvent.pointerDown(element, {
    button: 0,
    clientX: from.x,
    clientY: from.y,
    pointerId: 1,
  });
  for (const step of [0.5, 1])
    fireEvent.pointerMove(document, {
      clientX: from.x + (to.x - from.x) * step,
      clientY: from.y + (to.y - from.y) * step,
      pointerId: 1,
    });
  fireEvent.pointerUp(document, {
    clientX: to.x,
    clientY: to.y,
    pointerId: 1,
  });
}

describe("GanttChart interactions", () => {
  it("draws grouped rows, inclusive due bars, milestones and dependency arrows", () => {
    const first = makeTask({
      id: "first",
      title: "First",
      projects: ["[[Launch]]"],
      scheduled: "2026-08-17",
      due: "2026-08-18",
    });
    const second = makeTask({
      id: "second",
      title: "Second",
      projects: ["[[Launch]]"],
      due: "2026-08-20",
      blockedBy: [{ uid: "tasks/first.md", reltype: "FINISHTOSTART" }],
    });
    renderChart([first, second]);

    const rows = [...document.querySelectorAll(".tnc-tl-row")];
    expect(rows.map((row) => row.getAttribute("data-row"))).toEqual([
      "project:launch",
      "first",
      "second",
    ]);
    expect(rows[0]).toHaveClass("is-group");
    expect(rows[0]).toHaveTextContent("Launch2");
    expect(bar("first")).toHaveAccessibleName(/^First, Aug 17 — Aug 18\./);
    expect(bar("first").style.width).toBe("30px");
    expect(bar("second")).toHaveClass("is-milestone");
    expect(
      document.querySelector(
        '.tnc-tl-deps path[data-from="first"][data-to="second"]',
      ),
    ).not.toBeNull();
  });

  it("flags imported reversed dates without presenting them as a valid range", () => {
    const task = Object.freeze(
      makeTask({
        title: "Imported inversion",
        scheduled: "2026-11-02",
        due: "2026-10-29",
      }),
    );
    const { onSelect, onScheduleChange } = renderChart([task]);
    const warning = screen.getByText("Scheduled after due");
    expect(warning).toHaveAttribute(
      "title",
      "Scheduled Nov 2; due Oct 29. Scheduled is after the due date",
    );
    expect(screen.queryByText("Nov 2 — Oct 29")).not.toBeInTheDocument();
    const ledger = document.querySelector(".task-ledger-main")!;
    expect(ledger).toHaveAccessibleName(
      /Imported inversion, Scheduled Nov 2; due Oct 29.*Scheduled is after the due date/,
    );
    expect(bar("task")).toHaveAccessibleName(/Scheduled is after the due date/);
    fireEvent.click(ledger);
    expect(onSelect).toHaveBeenCalledWith(task);
    expect(onScheduleChange).not.toHaveBeenCalled();
  });

  it("gates timeline writes while keeping task selection available", () => {
    const task = makeTask({
      id: "blocked",
      title: "Blocked task",
      scheduled: "2026-08-17",
      due: "2026-08-18",
    });
    const { onSelect, onScheduleChange, onCompletionChange } = renderChart(
      [task],
      { mutationsDisabled: true },
    );

    expect(
      screen.getByRole("button", { name: "Complete Blocked task" }),
    ).toBeDisabled();
    expect(bar("blocked")).not.toHaveClass("is-draggable");
    expect(bar("blocked").querySelector(".tnc-port, .tnc-resize")).toBeNull();

    fireEvent.keyDown(bar("blocked"), { altKey: true, key: "ArrowRight" });
    fireEvent.click(bar("blocked"));
    expect(onSelect).toHaveBeenCalledWith(task);
    expect(onScheduleChange).not.toHaveBeenCalled();
    expect(onCompletionChange).not.toHaveBeenCalled();
  });

  it("zooms with Ctrl+wheel inside the chart and leaves plain wheel scrolling alone", () => {
    const task = makeTask({ id: "zoomable", scheduled: "2026-08-17" });
    const { onZoom } = renderChart([task]);
    const surface = document.querySelector<HTMLElement>(".gantt-scroll")!;

    const plain = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
    });
    surface.querySelector(".tnc-tl-scroll")!.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(onZoom).not.toHaveBeenCalled();

    const zoom = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 600,
      ctrlKey: true,
      deltaY: -100,
    });
    surface.querySelector(".tnc-tl-scroll")!.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(true);
    expect(onZoom).toHaveBeenCalledWith(1);
  });

  it("moves timed tasks in quarter-hour increments and keeps their stored form", async () => {
    const task = makeTask({
      id: "timed",
      title: "Timed task",
      scheduled: "2026-08-17T09:30:00",
      due: "2026-08-17T10:30:00Z",
    });
    const { onScheduleChange } = renderChart([task], { zoom: 7 });

    // 576px per day: 24px is one hour.
    drag(bar("timed"), { x: 600, y: TASK_ROW_Y }, { x: 624, y: TASK_ROW_Y });

    await waitFor(() =>
      expect(onScheduleChange).toHaveBeenCalledWith(task, {
        scheduled: "2026-08-17T10:30:00",
        due: "2026-08-17T11:30:00Z",
      }),
    );
  });

  it("resizes an all-day finish to an inclusive due date", async () => {
    const task = makeTask({
      id: "span",
      scheduled: "2026-08-17",
      due: "2026-08-18",
    });
    const { onScheduleChange } = renderChart([task], { zoom: 5 });

    // 34px per day: drag the finish grip two days later.
    const finish =
      350 +
      parseFloat(bar("span").style.left) +
      parseFloat(bar("span").style.width);
    drag(
      bar("span").querySelector(".tnc-resize-end")!,
      { x: finish, y: TASK_ROW_Y },
      { x: finish + 68, y: TASK_ROW_Y },
    );

    await waitFor(() =>
      expect(onScheduleChange).toHaveBeenCalledWith(task, {
        scheduled: "2026-08-17",
        due: "2026-08-20",
      }),
    );
  });

  it("creates a finish-to-start relationship by linking two bars", async () => {
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
    const { onDependenciesChange } = renderChart([source, target]);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => bar("target").querySelector(".tnc-port-start")),
    });

    drag(
      bar("source").querySelector(".tnc-port-finish")!,
      { x: 600, y: TASK_ROW_Y },
      { x: 650, y: TASK_ROW_Y + 49 },
    );

    await waitFor(() => expect(onDependenciesChange).toHaveBeenCalledOnce());
    expect(onDependenciesChange).toHaveBeenCalledWith(target, [
      { uid: "source", reltype: "FINISHTOSTART" },
    ]);
  });

  it.each([
    { target: "timeline", clientX: 420, saves: true },
    { target: "task ledger", clientX: 120, saves: false },
  ])(
    "handles unscheduled title drops over the $target",
    async ({ clientX, saves }) => {
      const task = makeTask({ id: "title-drag", title: "Unscheduled title" });
      const { onScheduleChange, onSelect } = renderChart([task]);
      const title = screen.getByRole("button", {
        name: /Unscheduled title, not scheduled. Select to edit or drag/,
      });
      drag(title, { x: 160, y: TASK_ROW_Y }, { x: clientX, y: TASK_ROW_Y });
      fireEvent.click(title);
      expect(onSelect).not.toHaveBeenCalled();
      if (saves) {
        await waitFor(() => expect(onScheduleChange).toHaveBeenCalledOnce());
        expect(onScheduleChange).toHaveBeenCalledWith(task, {
          due: undefined,
          scheduled: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        });
      } else {
        expect(onScheduleChange).not.toHaveBeenCalled();
        expect(screen.getByRole("status")).toHaveTextContent(
          "Schedule unchanged. Drop over a date in the timeline to schedule this task.",
        );
      }
    },
  );

  it("keeps an unscheduled title click as task selection", () => {
    const task = makeTask({ id: "title-click", title: "Unscheduled title" });
    const { onSelect, onScheduleChange } = renderChart([task]);
    const title = screen.getByRole("button", {
      name: /Unscheduled title, not scheduled/,
    });
    fireEvent.pointerDown(title, { button: 0, clientX: 160, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 160, pointerId: 1 });
    fireEvent.click(title);
    expect(onSelect).toHaveBeenCalledWith(task);
    expect(onScheduleChange).not.toHaveBeenCalled();
  });

  it("completes a task without opening its inspector", async () => {
    const task = makeTask({ id: "complete-me", title: "Complete me" });
    const onCompletionChange = vi.fn().mockResolvedValue(undefined);
    const onSelect = vi.fn();
    render(
      <GanttChart
        allTasks={[task]}
        selectedId={null}
        tasks={[task]}
        todayRequest={0}
        zoom={3}
        onCompletionChange={onCompletionChange}
        onDependenciesChange={vi.fn().mockResolvedValue(undefined)}
        onScheduleChange={vi.fn().mockResolvedValue(undefined)}
        onSelect={onSelect}
        onZoom={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Complete Complete me" }),
    );

    await waitFor(() => expect(onCompletionChange).toHaveBeenCalledWith(task));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps recurring-series completion in TaskNotes", () => {
    const task = makeTask({
      id: "recurring",
      title: "Recurring review",
      recurrence: "RRULE:FREQ=WEEKLY",
    });
    const onCompletionChange = vi.fn();
    render(
      <GanttChart
        allTasks={[task]}
        selectedId={null}
        tasks={[task]}
        todayRequest={0}
        zoom={3}
        onCompletionChange={onCompletionChange}
        onDependenciesChange={vi.fn().mockResolvedValue(undefined)}
        onScheduleChange={vi.fn().mockResolvedValue(undefined)}
        onSelect={() => undefined}
        onZoom={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Completion unavailable for recurring task Recurring review",
      }),
    );

    expect(onCompletionChange).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Complete recurring tasks in TaskNotes/),
    ).toBeInTheDocument();
  });
});
