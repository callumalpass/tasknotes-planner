import { Calendar } from "@tasknotes/calendar";
import "@tasknotes/calendar/calendar.css";
import { Check, GitBranch } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import type {
  CalendarItem,
  CalendarOptions,
  ExternalDragSource,
  ItemChangeArg,
  TimelineRow,
  TimelineScale as CalendarTimelineScale,
} from "@tasknotes/calendar";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  addOrReplaceDependency,
  canAddDependency,
  DAY_MINUTES,
  dateFromDate,
  dateLabel,
  dependencyRelationship,
  dependencyTaskIds,
  groupTasks,
  hasInvertedSchedule,
  placedSchedule,
  planningMinute,
  scheduleFromTimelineChange,
  taskHasTime,
  taskSpan,
  taskTimelineItem,
  timelineScale,
  type GanttRow,
  type TimelineChangeKind,
  type TimelineScale,
  type TimelineZoom,
} from "../domain/gantt";
import { errorMessage, isOperationOutcomeUnknown } from "../data/outcome";

import type {
  PlannerTask,
  ScheduleUpdate,
  TaskDependency,
} from "../domain/task";

/** Task id carried by an unscheduled task while it is dragged onto the timeline. */
type PlacementData = string;

const PHONE_QUERY = "(max-width: 560px)";
const LEDGER = {
  wide: { labelWidth: 350, rowHeight: 49 },
  phone: { labelWidth: 280, rowHeight: 65 },
} as const;

/** Days per scale unit, as the calendar's timeline measures them. */
const UNIT_DAYS: Record<CalendarTimelineScale["unit"], number> = {
  hour: 1 / 24,
  day: 1,
  week: 7,
  month: 30.44,
  quarter: 91.31,
};

interface InteractionMessage {
  tone: "neutral" | "success" | "danger";
  text: string;
}

interface GanttChartProps {
  tasks: readonly PlannerTask[];
  allTasks: readonly PlannerTask[];
  zoom: TimelineZoom;
  selectedId: string | null;
  todayRequest: number;
  mutationsDisabled?: boolean;
  onSelect(task: PlannerTask): void;
  onZoom(direction: -1 | 1): void;
  onScheduleChange(task: PlannerTask, update: ScheduleUpdate): Promise<void>;
  onCompletionChange(task: PlannerTask): Promise<void>;
  onDependenciesChange(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ): Promise<void>;
}

export function GanttChart(props: GanttChartProps) {
  if (!props.tasks.length)
    return (
      <section className="gantt-empty">
        <h2>No tasks match these controls</h2>
        <p>Change the saved view, search, or task filters.</p>
      </section>
    );
  return <GanttTimeline {...props} />;
}

function GanttTimeline({
  tasks,
  allTasks,
  zoom,
  selectedId,
  todayRequest,
  mutationsDisabled = false,
  onSelect,
  onZoom,
  onScheduleChange,
  onDependenciesChange,
  onCompletionChange,
}: GanttChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<Calendar<PlacementData> | null>(null);
  const wheelHandler = useRef<((event: WheelEvent) => void) | null>(null);
  const previousScale = useRef<{ scale: TimelineScale; labelWidth: number }>(
    null,
  );
  const pendingZoomAnchor = useRef<{
    minute: number;
    viewportX: number;
  } | null>(null);
  const lastTodayRequest = useRef<number | null>(null);
  const statusTimer = useRef<number | null>(null);
  // Ledger labels are React portals, so their clicks reach React before the
  // calendar can suppress the click that ends a placement drag.
  const placementClick = useRef(false);
  const [labelHosts, setLabelHosts] = useState<
    ReadonlyMap<string, HTMLElement>
  >(() => new Map());
  const [interactionMessage, setInteractionMessage] =
    useState<InteractionMessage | null>(null);
  const [completionPending, setCompletionPending] = useState<Set<string>>(
    () => new Set(),
  );
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const { labelWidth, rowHeight } = useMediaQuery(PHONE_QUERY)
    ? LEDGER.phone
    : LEDGER.wide;
  const today = dateFromDate(new Date());
  const scale = useMemo(
    () => timelineScale(tasks, zoom, today, timelineViewportWidth),
    [tasks, timelineViewportWidth, today, zoom],
  );
  const rows = useMemo(() => groupTasks(tasks), [tasks]);
  const timelineRows = useMemo(
    () =>
      rows.map((row): TimelineRow =>
        row.kind === "group"
          ? { id: row.id, title: row.label, group: true }
          : { id: row.id, title: row.task.title },
      ),
    [rows],
  );
  const tasksById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  );
  const items = useMemo(
    () =>
      tasks.flatMap((task): CalendarItem<PlacementData>[] => {
        const schedule = taskTimelineItem(task, scale.snapMinutes);
        if (!schedule) return [];
        const color = task.completed ? "var(--success)" : "var(--accent)";
        return [
          {
            id: task.id,
            title: task.title,
            start: schedule.start,
            end: schedule.end,
            allDay: schedule.allDay,
            kind: schedule.milestone ? "milestone" : "task",
            completed: task.completed,
            color,
            backgroundColor: color,
            textColor: "var(--paper)",
            dependsOn: dependencyTaskIds(task, allTasks),
          },
        ];
      }),
    [allTasks, scale.snapMinutes, tasks],
  );

  function showMessage(message: InteractionMessage, duration = 2_200) {
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    setInteractionMessage(message);
    statusTimer.current = window.setTimeout(
      () => setInteractionMessage(null),
      duration,
    );
  }

  async function commitSchedule(
    task: PlannerTask,
    update: ScheduleUpdate,
  ): Promise<boolean> {
    if (mutationsDisabled) return false;
    showMessage({ tone: "neutral", text: "Saving schedule…" }, 10_000);
    try {
      await onScheduleChange(task, update);
      showMessage({ tone: "success", text: "Schedule saved" });
      return true;
    } catch (reason) {
      showMessage(
        {
          tone: "danger",
          text: isOperationOutcomeUnknown(reason)
            ? `Schedule outcome is unknown. ${errorMessage(reason)}`
            : `Schedule not saved. ${errorMessage(reason)}`,
        },
        5_000,
      );
      return false;
    }
  }

  async function commitDependencies(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ) {
    if (mutationsDisabled) return;
    showMessage({ tone: "neutral", text: "Saving relationship…" }, 10_000);
    try {
      await onDependenciesChange(task, dependencies);
      showMessage({ tone: "success", text: "Relationship saved" });
    } catch (reason) {
      showMessage(
        {
          tone: "danger",
          text: isOperationOutcomeUnknown(reason)
            ? `Relationship outcome is unknown. ${errorMessage(reason)}`
            : `Relationship not saved. ${errorMessage(reason)}`,
        },
        5_000,
      );
    }
  }

  async function commitCompletion(task: PlannerTask) {
    if (mutationsDisabled) return;
    if (task.recurrence) {
      showMessage(
        {
          tone: "neutral",
          text: "Complete recurring tasks in TaskNotes, where you can choose an occurrence.",
        },
        4_500,
      );
      return;
    }
    setCompletionPending((current) => new Set(current).add(task.id));
    showMessage(
      {
        tone: "neutral",
        text: task.completed ? "Reopening task…" : "Completing task…",
      },
      10_000,
    );
    try {
      await onCompletionChange(task);
      showMessage({
        tone: "success",
        text: task.completed ? "Task reopened" : "Task completed",
      });
    } catch (reason) {
      showMessage(
        {
          tone: "danger",
          text: isOperationOutcomeUnknown(reason)
            ? `Task outcome is unknown. ${errorMessage(reason)}`
            : `Task not changed. ${errorMessage(reason)}`,
        },
        5_000,
      );
    } finally {
      setCompletionPending((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  }

  /** Rejects when the write fails so the calendar restores the bar. */
  async function writeTimelineChange(
    arg: ItemChangeArg<PlacementData>,
    kind: TimelineChangeKind,
  ) {
    const task = tasksById.get(arg.item.id);
    if (!task) throw new Error("The task is no longer visible.");
    const update = scheduleFromTimelineChange(
      task,
      kind,
      { start: arg.startStr, end: arg.endStr, allDay: arg.allDay },
      scale.snapMinutes,
    );
    if (!(await commitSchedule(task, update)))
      throw new Error("Schedule not saved.");
  }

  function linkTasks(fromId: string, toId: string) {
    const allowed = canAddDependency(allTasks, fromId, toId);
    if (!allowed.allowed) {
      showMessage({ tone: "danger", text: allowed.reason }, 3_500);
      return;
    }
    const target = allTasks.find((task) => task.id === toId);
    if (!target) return;
    void commitDependencies(
      target,
      addOrReplaceDependency(
        target.blockedBy,
        fromId,
        dependencyRelationship("finish", "start"),
        allTasks,
      ),
    );
  }

  function beginPlacement(
    event: ReactPointerEvent<HTMLElement>,
    task: PlannerTask,
  ) {
    const calendar = calendarRef.current;
    if (mutationsDisabled || event.button !== 0 || !calendar) return;
    const origin = event.nativeEvent;
    const doc = event.currentTarget.ownerDocument;
    const touch = origin.pointerType === "touch";
    const source: ExternalDragSource<PlacementData> = {
      title: task.title,
      durationMinutes: scale.intraday ? scale.snapMinutes : undefined,
      color: "var(--accent)",
      kind: "task",
      data: task.id,
    };
    let timer: number | null = null;
    const stop = () => {
      if (timer !== null) window.clearTimeout(timer);
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", stop);
      doc.removeEventListener("pointercancel", stop);
    };
    const start = (from: PointerEvent) => {
      stop();
      placementClick.current = true;
      doc.addEventListener(
        "pointerup",
        () => window.setTimeout(() => (placementClick.current = false), 0),
        { once: true },
      );
      calendar.beginExternalDrag(from, source);
    };
    // Mouse placement starts after a small movement so a click still selects;
    // touch placement needs a long press so the ledger keeps scrolling.
    function move(next: PointerEvent) {
      if (next.pointerId !== origin.pointerId) return;
      const distance = Math.hypot(
        next.clientX - origin.clientX,
        next.clientY - origin.clientY,
      );
      if (touch) {
        if (distance > 8) stop();
      } else if (distance >= 4) start(next);
    }
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", stop);
    doc.addEventListener("pointercancel", stop);
    if (touch)
      timer = window.setTimeout(() => {
        navigator.vibrate?.(10);
        start(origin);
      }, 350);
  }

  function placeTask(
    taskId: string | undefined,
    start: string,
    allDay: boolean,
    pointer: MouseEvent | KeyboardEvent | null,
  ) {
    const task = taskId ? tasksById.get(taskId) : undefined;
    const surface = host.current;
    if (!task || !surface) return;
    const bounds = surface.getBoundingClientRect();
    const inside =
      pointer &&
      "clientX" in pointer &&
      pointer.clientX >= bounds.left + labelWidth &&
      pointer.clientX < bounds.right &&
      pointer.clientY >= bounds.top &&
      pointer.clientY < bounds.bottom;
    if (!inside) {
      showMessage(
        {
          tone: "neutral",
          text: "Schedule unchanged. Drop over a date in the timeline to schedule this task.",
        },
        4_500,
      );
      return;
    }
    void commitSchedule(task, placedSchedule(start, allDay));
  }

  function itemLabel(task: PlannerTask): string {
    if (mutationsDisabled)
      return `${task.title}, ${scheduleLabel(task)}. Select to review.`;
    const step =
      scale.intraday && taskHasTime(task)
        ? scale.snapMinutes === 15
          ? "15 minutes"
          : "one hour"
        : "one day";
    return `${task.title}, ${scheduleLabel(task)}. Drag to move; Alt plus arrow keys move by ${step}; Alt plus Shift plus arrow keys change the end.`;
  }

  const options: Partial<CalendarOptions<PlacementData>> = {
    view: "timeline",
    date: scale.start,
    toolbar: false,
    timeZone: "local",
    height: "fill",
    editable: !mutationsDisabled,
    selectable: false,
    navLinks: false,
    timeline: {
      rows: timelineRows,
      rowOf: (item) => item.id,
      scale: calendarScale(scale),
      days: scale.days.length,
      leadDays: 0,
      labelWidth,
      rowHeight,
      dependencies: true,
      rowContent: (row, element) => {
        element.classList.add("gantt-ledger-host");
        setLabelHosts((current) =>
          current.get(row.id) === element
            ? current
            : new Map(current).set(row.id, element),
        );
      },
      onLink: mutationsDisabled
        ? undefined
        : ({ from, to }) => linkTasks(from.id, to.id),
    },
    onItemClick: ({ item }) => {
      const task = tasksById.get(item.id);
      if (task) onSelect(task);
    },
    onItemDrop: (arg) => writeTimelineChange(arg, "move"),
    onItemResize: (arg) =>
      writeTimelineChange(
        arg,
        arg.start.getTime() !== arg.oldStart.getTime()
          ? "resize-start"
          : "resize-finish",
      ),
    onExternalDrop: (arg) =>
      placeTask(arg.source?.data, arg.startStr, arg.allDay, arg.jsEvent),
    itemDidMount: ({ item, el, isMirror }) => {
      const task = tasksById.get(item.id);
      if (!task || isMirror) return;
      el.setAttribute("aria-label", itemLabel(task));
      el.classList.toggle("is-selected", item.id === selectedId);
    },
  };

  useLayoutEffect(() => {
    const surface = host.current;
    if (!surface) return;
    const calendar = new Calendar<PlacementData>(surface, {
      view: "timeline",
      toolbar: false,
    });
    calendarRef.current = calendar;
    const wheel = (event: WheelEvent) => wheelHandler.current?.(event);
    surface.addEventListener("wheel", wheel, { passive: false });
    const updateWidth = () => {
      const width = Math.max(0, surface.clientWidth - labelWidthOf(surface));
      setTimelineViewportWidth((current) =>
        Math.abs(current - width) < 1 ? current : width,
      );
    };
    updateWidth();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateWidth);
    observer?.observe(surface);
    return () => {
      observer?.disconnect();
      surface.removeEventListener("wheel", wheel);
      calendar.destroy();
      calendarRef.current = null;
      previousScale.current = null;
      lastTodayRequest.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const calendar = calendarRef.current;
    const surface = host.current;
    if (!calendar || !surface) return;
    const scroll = calendar.getScroll();
    const previous = previousScale.current;
    let anchor = pendingZoomAnchor.current;
    pendingZoomAnchor.current = null;
    const rescaled =
      previous &&
      (previous.scale.start !== scale.start ||
        previous.scale.cellWidth !== scale.cellWidth ||
        previous.labelWidth !== labelWidth);
    if (rescaled && !anchor) {
      const viewportX =
        previous.labelWidth + (surface.clientWidth - previous.labelWidth) / 2;
      anchor = {
        viewportX,
        minute:
          planningMinute(previous.scale.start)! +
          ((scroll.left + viewportX - previous.labelWidth) /
            previous.scale.cellWidth) *
            DAY_MINUTES,
      };
    }
    previousScale.current = { scale, labelWidth };

    calendar.setOptions(options);
    calendar.setItems(items);
    calendar.flush();

    const startMinute = planningMinute(scale.start)!;
    const xOf = (minute: number) =>
      labelWidth + ((minute - startMinute) / DAY_MINUTES) * scale.cellWidth;
    if (rescaled && anchor)
      calendar.setScroll({
        top: scroll.top,
        left: Math.max(0, xOf(anchor.minute) - anchor.viewportX),
      });
    if (lastTodayRequest.current !== todayRequest) {
      lastTodayRequest.current = todayRequest;
      const now = new Date();
      const todayMinute = scale.intraday
        ? planningMinute(today)! + now.getHours() * 60 + now.getMinutes()
        : planningMinute(today)!;
      calendar.setScroll({
        top: calendar.getScroll().top,
        left: Math.max(
          0,
          xOf(todayMinute) -
            (labelWidth + (surface.clientWidth - labelWidth) / 2),
        ),
      });
    }

    for (const element of surface.querySelectorAll(".tnc-item.is-selected"))
      element.classList.remove("is-selected");
    if (selectedId)
      for (const element of calendar.elementsFor(selectedId))
        element.classList.add("is-selected");

    wheelHandler.current = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY === 0) return;
      const bounds = surface.getBoundingClientRect();
      const viewportX = Math.max(labelWidth, event.clientX - bounds.left);
      pendingZoomAnchor.current = {
        viewportX,
        minute:
          startMinute +
          ((calendar.getScroll().left + viewportX - labelWidth) /
            scale.cellWidth) *
            DAY_MINUTES,
      };
      onZoom(event.deltaY < 0 ? 1 : -1);
    };
  });

  useEffect(
    () => () => {
      if (statusTimer.current !== null)
        window.clearTimeout(statusTimer.current);
    },
    [],
  );

  return (
    <section className="gantt-frame" aria-label="Task timeline">
      <div className="gantt-scroll" ref={host} />
      {rows.map((row) => {
        const element = labelHosts.get(row.id);
        if (!element) return null;
        return createPortal(
          row.kind === "group" ? (
            <GroupLedger row={row} />
          ) : (
            <TaskLedger
              completionPending={completionPending.has(row.task.id)}
              mutationsDisabled={mutationsDisabled}
              selected={selectedId === row.task.id}
              task={row.task}
              onBeginPlacement={beginPlacement}
              onCompletionChange={commitCompletion}
              onSelect={(task) => {
                if (!placementClick.current) onSelect(task);
              }}
            />
          ),
          element,
          row.id,
        );
      })}
      {interactionMessage ? (
        <p
          className={`gantt-interaction-message is-${interactionMessage.tone}`}
          role={interactionMessage.tone === "danger" ? "alert" : "status"}
        >
          {interactionMessage.text}
        </p>
      ) : null}
    </section>
  );
}

function GroupLedger({ row }: { row: Extract<GanttRow, { kind: "group" }> }) {
  return (
    <div className="group-ledger">
      <span>{row.label}</span>
      <small>{row.count}</small>
    </div>
  );
}

function TaskLedger({
  task,
  selected,
  completionPending,
  mutationsDisabled,
  onSelect,
  onCompletionChange,
  onBeginPlacement,
}: {
  task: PlannerTask;
  selected: boolean;
  completionPending: boolean;
  mutationsDisabled: boolean;
  onSelect(task: PlannerTask): void;
  onCompletionChange(task: PlannerTask): Promise<void>;
  onBeginPlacement(
    event: ReactPointerEvent<HTMLElement>,
    task: PlannerTask,
  ): void;
}) {
  const inverted = hasInvertedSchedule(task);
  const placeable = !taskSpan(task) && !mutationsDisabled;
  return (
    <div className={`task-ledger${selected ? " is-selected" : ""}`}>
      <button
        aria-busy={completionPending || undefined}
        aria-disabled={task.recurrence ? "true" : undefined}
        aria-label={
          task.recurrence
            ? `Completion unavailable for recurring task ${task.title}`
            : `${task.completed ? "Reopen" : "Complete"} ${task.title}`
        }
        className="completion-control"
        disabled={completionPending || mutationsDisabled}
        title={
          task.recurrence
            ? "Complete recurring tasks in TaskNotes, where you can choose an occurrence."
            : task.completed
              ? "Reopen task"
              : "Complete task"
        }
        type="button"
        onClick={() => void onCompletionChange(task)}
      >
        <span
          className={`completion-mark${task.completed ? " is-complete" : ""}`}
        >
          {task.completed ? <Check aria-hidden="true" size={12} /> : null}
        </span>
      </button>
      <button
        aria-label={
          inverted
            ? `${task.title}, ${scheduleLabel(task)}. Select to edit dates.`
            : placeable
              ? `${task.title}, not scheduled. Select to edit or drag to a date in the timeline.`
              : undefined
        }
        className={`task-ledger-main${placeable ? " is-placeable" : ""}`}
        type="button"
        onClick={() => onSelect(task)}
        onPointerDown={
          placeable ? (event) => onBeginPlacement(event, task) : undefined
        }
      >
        <span className="ledger-title">
          <strong>{task.title}</strong>
          <small
            className={inverted ? "schedule-warning" : undefined}
            title={inverted ? scheduleLabel(task) : undefined}
          >
            {inverted ? "Scheduled after due" : scheduleLabel(task)}
          </small>
        </span>
        <span
          aria-label={`${task.statusLabel}; ${task.priorityLabel} priority`}
          className="ledger-state"
          title={`${task.statusLabel} · ${task.priorityLabel} priority`}
        >
          <i style={{ background: task.statusColor }} />
          <i style={{ background: task.priorityColor }} />
        </span>
        {task.blockedBy.length ? (
          <GitBranch
            aria-label={`${task.blockedBy.length} dependencies`}
            size={14}
          />
        ) : null}
      </button>
    </div>
  );
}

/** The calendar scale whose day width equals Planner's authored cell width. */
function calendarScale(scale: TimelineScale): CalendarTimelineScale {
  const unit: CalendarTimelineScale["unit"] = scale.intraday
    ? "hour"
    : scale.cellWidth >= 22
      ? "day"
      : scale.cellWidth >= 10
        ? "week"
        : scale.cellWidth >= 6
          ? "month"
          : "quarter";
  return {
    unit,
    unitWidth: scale.cellWidth * UNIT_DAYS[unit],
    snapMinutes: scale.snapMinutes,
  };
}

function labelWidthOf(surface: HTMLElement): number {
  return surface.ownerDocument.defaultView?.matchMedia?.(PHONE_QUERY).matches
    ? LEDGER.phone.labelWidth
    : LEDGER.wide.labelWidth;
}

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia?.(query);
      media?.addEventListener?.("change", onChange);
      return () => media?.removeEventListener?.("change", onChange);
    },
    () => window.matchMedia?.(query).matches ?? false,
  );
}

function scheduleLabel(task: PlannerTask): string {
  if (hasInvertedSchedule(task)) {
    return `Scheduled ${scheduleValueLabel(task.scheduled!)}; due ${scheduleValueLabel(task.due!)}. Scheduled is after the due date`;
  }
  const span = taskSpan(task);
  if (!span) return "Not scheduled";
  if (span.milestone) return `Due ${scheduleValueLabel(task.due!)}`;
  return `${scheduleValueLabel(task.scheduled!)} — ${scheduleValueLabel(task.due ?? task.scheduled!)}`;
}

function scheduleValueLabel(value: string): string {
  const time = /T(\d{2}:\d{2})/.exec(value)?.[1];
  const date = value.slice(0, 10);
  return time ? `${dateLabel(date)} ${time}` : dateLabel(date);
}
