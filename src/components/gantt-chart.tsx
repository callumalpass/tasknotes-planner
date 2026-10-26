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
  LinkDragArg,
  TimelineAnchor,
  TimelineRow,
  TimelineScale as CalendarTimelineScale,
} from "@tasknotes/calendar";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  addOrReplaceDependency,
  canAddDependency,
  dateFromDate,
  dateLabel,
  dependencyRelationship,
  groupTasks,
  hasInvertedSchedule,
  placedSchedule,
  scheduleFromTimelineChange,
  taskHasTime,
  taskSpan,
  taskTimelineItem,
  timelineDependencies,
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
  // The pointer position of a Ctrl/Cmd+wheel zoom, kept in place on rescale.
  const pendingZoomAnchor = useRef<TimelineAnchor | null>(null);
  const lastTodayRequest = useRef<number | null>(null);
  const statusTimer = useRef<number | null>(null);
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
            dependsOn: timelineDependencies(task, allTasks),
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

  function linkTasks(
    fromId: string,
    toId: string,
    fromEdge: "start" | "finish",
    toEdge: "start" | "finish",
  ) {
    const target = allTasks.find((task) => task.id === toId);
    if (!target) return;
    void commitDependencies(
      target,
      addOrReplaceDependency(
        target.blockedBy,
        fromId,
        dependencyRelationship(fromEdge, toEdge),
        allTasks,
      ),
    );
  }

  /** Live guidance while a relationship handle is dragged. */
  function showLinkDrag(drag: LinkDragArg<PlacementData>) {
    if (drag.phase === "end") {
      if (drag.to && !drag.valid && drag.reason)
        showMessage({ tone: "danger", text: drag.reason }, 3_500);
      else if (!drag.linked) setInteractionMessage(null);
      return;
    }
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    setInteractionMessage(
      drag.to && !drag.valid && drag.reason
        ? { tone: "danger", text: drag.reason }
        : {
            tone: "neutral",
            text: "Drop on a task edge to set the relationship",
          },
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

  /** The calendar only drops on task rows, headings and the date header. */
  function placeTask(
    taskId: string | undefined,
    start: string,
    allDay: boolean,
  ) {
    const task = taskId ? tasksById.get(taskId) : undefined;
    if (task) void commitSchedule(task, placedSchedule(start, allDay));
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
    return `${task.title}, ${scheduleLabel(task)}. Drag to move; Alt plus arrow keys move by ${step}.`;
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
    selected: selectedId,
    timeline: {
      rows: timelineRows,
      rowOf: (item) => item.id,
      scale: calendarScale(scale),
      days: scale.days.length,
      leadDays: 0,
      labelWidth,
      rowHeight,
      dependencies: true,
      todayLabel: scale.intraday ? "Now" : "Today",
      rowLabelDidMount: ({ row, el }) => {
        el.classList.add("gantt-ledger-host");
        setLabelHosts((current) =>
          current.get(row.id) === el
            ? current
            : new Map(current).set(row.id, el),
        );
      },
      rowLabelWillUnmount: ({ row, el }) =>
        setLabelHosts((current) => {
          if (current.get(row.id) !== el) return current;
          const next = new Map(current);
          next.delete(row.id);
          return next;
        }),
      resizeHandleLabel: mutationsDisabled
        ? undefined
        : ({ item, edge }) =>
            `Change ${item.title} ${edge === "start" ? "scheduled" : "due"} date`,
      onLink: mutationsDisabled
        ? undefined
        : ({ from, to, fromEdge, toEdge }) =>
            linkTasks(from.id, to.id, fromEdge, toEdge),
      canLink: ({ from, to }) => {
        const allowed = canAddDependency(allTasks, from.id, to.id);
        return allowed.allowed || allowed.reason;
      },
      onLinkDrag: showLinkDrag,
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
      placeTask(arg.source?.data, arg.startStr, arg.allDay),
    onExternalDragEnd: ({ dropped }) => {
      if (!dropped)
        showMessage(
          {
            tone: "neutral",
            text: "Schedule unchanged. Drop over a date in the timeline to schedule this task.",
          },
          4_500,
        );
    },
    itemDidMount: ({ item, el, isMirror }) => {
      const task = tasksById.get(item.id);
      if (!task || isMirror) return;
      el.setAttribute("aria-label", itemLabel(task));
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
      lastTodayRequest.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const calendar = calendarRef.current;
    const surface = host.current;
    if (!calendar || !surface) return;
    // The calendar keeps the visible dates when the scale or range changes;
    // a wheel zoom keeps the date under the pointer instead.
    const anchor = pendingZoomAnchor.current;
    pendingZoomAnchor.current = null;
    calendar.setOptions(options, anchor ? { anchor } : undefined);
    calendar.setItems(items);
    calendar.flush();

    if (lastTodayRequest.current !== todayRequest) {
      const first = lastTodayRequest.current === null;
      lastTodayRequest.current = todayRequest;
      calendar.scrollToDate(scale.intraday ? new Date() : today, {
        align: "center",
        smooth: !first && todayRequest > 0,
      });
    }

    wheelHandler.current = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.deltaY === 0) return;
      const bounds = surface.getBoundingClientRect();
      pendingZoomAnchor.current = {
        clientX: Math.max(bounds.left + labelWidth, event.clientX),
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
              onSelect={onSelect}
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

/** Planner's authored cell width as the calendar's day width; the unit picks header ticks. */
function calendarScale(scale: TimelineScale): Partial<CalendarTimelineScale> {
  const unit: CalendarTimelineScale["unit"] = scale.intraday
    ? "hour"
    : scale.cellWidth >= 22
      ? "day"
      : scale.cellWidth >= 10
        ? "week"
        : scale.cellWidth >= 6
          ? "month"
          : "quarter";
  return { unit, dayWidth: scale.cellWidth, snapMinutes: scale.snapMinutes };
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
