import { Check, GitBranch, Minus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";

import {
  addDays,
  addOrReplaceDependency,
  canAddDependency,
  dateFromDate,
  dateLabel,
  daysBetween,
  dependencyRelationship,
  groupTasks,
  resolveDependencyTask,
  resizedSchedule,
  shiftedSchedule,
  taskSpan,
  timelineScale,
  withSchedule,
  type GanttRow,
  type TimelineZoom,
} from "../domain/gantt";
import { errorMessage } from "../data/outcome";

import type {
  PlannerTask,
  ScheduleUpdate,
  TaskDependency,
} from "../domain/task";

const TASK_COLUMN = 350;
const GROUP_HEIGHT = 35;
const TASK_HEIGHT = 49;

type ScheduleDragKind = "move" | "resize-start" | "resize-finish" | "place";

interface ScheduleDrag {
  task: PlannerTask;
  kind: ScheduleDragKind;
  originClientX: number;
  timelineLeft: number;
  update: ScheduleUpdate;
  changed: boolean;
}

interface SchedulePreview {
  taskId: string;
  update: ScheduleUpdate;
}

interface LinkDrag {
  sourceId: string;
  sourceEdge: "start" | "finish";
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  targetId?: string;
  targetEdge?: "start" | "finish";
  invalidReason?: string;
}

interface InteractionMessage {
  tone: "neutral" | "success" | "danger";
  text: string;
}

export function GanttChart({
  tasks,
  allTasks,
  zoom,
  selectedId,
  todayRequest,
  onSelect,
  onZoom,
  onScheduleChange,
  onDependenciesChange,
}: {
  tasks: readonly PlannerTask[];
  allTasks: readonly PlannerTask[];
  zoom: TimelineZoom;
  selectedId: string | null;
  todayRequest: number;
  onSelect(task: PlannerTask): void;
  onZoom(direction: -1 | 1): void;
  onScheduleChange(task: PlannerTask, update: ScheduleUpdate): Promise<void>;
  onDependenciesChange(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ): Promise<void>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const scheduleDrag = useRef<ScheduleDrag | null>(null);
  const activeLink = useRef<LinkDrag | null>(null);
  const suppressClick = useRef(false);
  const pendingZoomAnchor = useRef<{
    date: string;
    viewportX: number;
  } | null>(null);
  const statusTimer = useRef<number | null>(null);
  const lastTodayRequest = useRef<number | null>(null);
  const [schedulePreview, setSchedulePreview] =
    useState<SchedulePreview | null>(null);
  const [linkDrag, setLinkDrag] = useState<LinkDrag | null>(null);
  const [interactionMessage, setInteractionMessage] =
    useState<InteractionMessage | null>(null);
  const today = dateFromDate(new Date());
  const scale = useMemo(
    () => timelineScale(tasks, zoom, today),
    [tasks, today, zoom],
  );
  const previousScale = useRef(scale);
  const rows = useMemo(() => groupTasks(tasks), [tasks]);
  const timelineWidth = scale.days.length * scale.cellWidth;
  const bodyHeight = rows.reduce(
    (height, row) =>
      height + (row.kind === "group" ? GROUP_HEIGHT : TASK_HEIGHT),
    0,
  );
  const todayX = daysBetween(scale.start, today) * scale.cellWidth;

  useLayoutEffect(() => {
    const surface = scroller.current;
    const previous = previousScale.current;
    if (!surface) return;
    if (
      previous.cellWidth !== scale.cellWidth ||
      previous.start !== scale.start
    ) {
      const taskColumn = taskColumnWidth(surface);
      const pending = pendingZoomAnchor.current;
      const viewportX = pending?.viewportX ?? surface.clientWidth / 2;
      const anchorDate =
        pending?.date ??
        addDays(
          previous.start,
          Math.round(
            (surface.scrollLeft + viewportX - taskColumn) / previous.cellWidth,
          ),
        );
      surface.scrollLeft = Math.max(
        0,
        taskColumn +
          daysBetween(scale.start, anchorDate) * scale.cellWidth -
          viewportX,
      );
    }
    pendingZoomAnchor.current = null;
    previousScale.current = scale;
  }, [scale]);

  useEffect(() => {
    if (lastTodayRequest.current === todayRequest) return;
    lastTodayRequest.current = todayRequest;
    const surface = scroller.current;
    if (!surface) return;
    const taskColumn = taskColumnWidth(surface);
    const left = Math.max(0, taskColumn + todayX - surface.clientWidth * 0.55);
    surface.scrollTo({
      left,
      behavior: todayRequest ? "smooth" : "auto",
    });
  }, [todayRequest, todayX]);

  useEffect(
    () => () => {
      if (statusTimer.current !== null)
        window.clearTimeout(statusTimer.current);
    },
    [],
  );

  function showMessage(message: InteractionMessage, duration = 2_200) {
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    setInteractionMessage(message);
    statusTimer.current = window.setTimeout(
      () => setInteractionMessage(null),
      duration,
    );
  }

  async function commitSchedule(task: PlannerTask, update: ScheduleUpdate) {
    showMessage({ tone: "neutral", text: "Saving schedule…" }, 10_000);
    try {
      await onScheduleChange(task, update);
      showMessage({ tone: "success", text: "Schedule saved" });
    } catch (reason) {
      showMessage(
        {
          tone: "danger",
          text: `Schedule not saved. ${errorMessage(reason)}`,
        },
        5_000,
      );
    }
  }

  async function commitDependencies(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ) {
    showMessage({ tone: "neutral", text: "Saving relationship…" }, 10_000);
    try {
      await onDependenciesChange(task, dependencies);
      showMessage({ tone: "success", text: "Relationship saved" });
    } catch (reason) {
      showMessage(
        {
          tone: "danger",
          text: `Relationship not saved. ${errorMessage(reason)}`,
        },
        5_000,
      );
    }
  }

  function beginScheduleDrag(
    event: ReactPointerEvent<HTMLElement>,
    task: PlannerTask,
    kind: ScheduleDragKind,
  ) {
    if (event.button !== 0) return;
    const timeline = event.currentTarget.closest<HTMLElement>(".timeline-row");
    if (!timeline) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    scheduleDrag.current = {
      task,
      kind,
      originClientX: event.clientX,
      timelineLeft: timeline.getBoundingClientRect().left,
      update: { scheduled: task.scheduled, due: task.due },
      changed: false,
    };
    window.addEventListener("pointermove", moveWindowScheduleDrag);
    window.addEventListener("pointerup", endWindowScheduleDrag);
    window.addEventListener("pointercancel", cancelWindowScheduleDrag);
  }

  function moveScheduleDrag(event: { clientX: number }) {
    const current = scheduleDrag.current;
    if (!current) return;
    const delta = Math.round(
      (event.clientX - current.originClientX) / scale.cellWidth,
    );
    const moved = Math.abs(event.clientX - current.originClientX) >= 4;
    let update = current.update;
    if (current.kind === "move") update = shiftedSchedule(current.task, delta);
    else if (current.kind === "place") {
      const day = Math.max(
        0,
        Math.min(
          scale.days.length - 1,
          Math.floor((event.clientX - current.timelineLeft) / scale.cellWidth),
        ),
      );
      update = { scheduled: addDays(scale.start, day), due: undefined };
    } else {
      const span = taskSpan(current.task);
      if (span) {
        const edge = current.kind === "resize-start" ? "start" : "finish";
        const origin = edge === "start" ? span.start : span.end;
        update = resizedSchedule(current.task, edge, addDays(origin, delta));
      }
    }
    scheduleDrag.current = { ...current, update, changed: moved };
    if (moved) setSchedulePreview({ taskId: current.task.id, update });
  }

  function endScheduleDrag() {
    const current = scheduleDrag.current;
    if (!current) return;
    removeWindowScheduleListeners();
    scheduleDrag.current = null;
    setSchedulePreview(null);
    if (!current.changed) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    void commitSchedule(current.task, current.update);
  }

  function cancelScheduleDrag() {
    removeWindowScheduleListeners();
    scheduleDrag.current = null;
    setSchedulePreview(null);
  }

  function moveWindowScheduleDrag(event: PointerEvent) {
    moveScheduleDrag(event);
  }

  function endWindowScheduleDrag() {
    endScheduleDrag();
  }

  function cancelWindowScheduleDrag() {
    cancelScheduleDrag();
  }

  function removeWindowScheduleListeners() {
    window.removeEventListener("pointermove", moveWindowScheduleDrag);
    window.removeEventListener("pointerup", endWindowScheduleDrag);
    window.removeEventListener("pointercancel", cancelWindowScheduleDrag);
  }

  function nudgeSchedule(
    task: PlannerTask,
    kind: Exclude<ScheduleDragKind, "place">,
    days: number,
  ) {
    const span = taskSpan(task);
    if (!span) return;
    const update =
      kind === "move"
        ? shiftedSchedule(task, days)
        : resizedSchedule(
            task,
            kind === "resize-start" ? "start" : "finish",
            addDays(kind === "resize-start" ? span.start : span.end, days),
          );
    void commitSchedule(task, update);
  }

  function beginLink(
    event: ReactPointerEvent<HTMLButtonElement>,
    task: PlannerTask,
    edge: "start" | "finish",
  ) {
    if (event.button !== 0 || !body.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const port = event.currentTarget.getBoundingClientRect();
    const coordinates = timelineCoordinates(
      port.left + port.width / 2,
      port.top + port.height / 2,
    );
    if (!coordinates) return;
    const next: LinkDrag = {
      sourceId: task.id,
      sourceEdge: edge,
      startX: coordinates.x,
      startY: coordinates.y,
      currentX: coordinates.x,
      currentY: coordinates.y,
    };
    activeLink.current = next;
    setLinkDrag(next);
  }

  function moveLink(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = activeLink.current;
    if (!current) return;
    const coordinates = timelineCoordinates(event.clientX, event.clientY);
    if (!coordinates) return;
    const port = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLButtonElement>(".link-port[data-task-id]");
    const targetId = port?.dataset.taskId;
    const targetEdge = port?.dataset.edge as "start" | "finish" | undefined;
    const allowed = targetId
      ? canAddDependency(allTasks, current.sourceId, targetId)
      : null;
    const next: LinkDrag = {
      ...current,
      currentX: coordinates.x,
      currentY: coordinates.y,
      targetId,
      targetEdge,
      invalidReason: allowed && !allowed.allowed ? allowed.reason : undefined,
    };
    activeLink.current = next;
    setLinkDrag(next);
  }

  function endLink(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = activeLink.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    activeLink.current = null;
    setLinkDrag(null);
    if (!current?.targetId || !current.targetEdge || current.invalidReason) {
      if (current?.invalidReason)
        showMessage({ tone: "danger", text: current.invalidReason }, 3_500);
      return;
    }
    const target = allTasks.find((task) => task.id === current.targetId);
    if (!target) return;
    void commitDependencies(
      target,
      addOrReplaceDependency(
        target.blockedBy,
        current.sourceId,
        dependencyRelationship(current.sourceEdge, current.targetEdge),
        allTasks,
      ),
    );
  }

  function cancelLink() {
    activeLink.current = null;
    setLinkDrag(null);
  }

  function timelineCoordinates(clientX: number, clientY: number) {
    const bodyElement = body.current;
    const surface = scroller.current;
    if (!bodyElement || !surface) return null;
    const bounds = bodyElement.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          timelineWidth,
          clientX - bounds.left - taskColumnWidth(surface),
        ),
      ),
      y: Math.max(0, Math.min(bodyHeight, clientY - bounds.top)),
    };
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const surface = scroller.current;
    if (!surface || event.deltaY === 0) return;
    const bounds = surface.getBoundingClientRect();
    const viewportX = event.clientX - bounds.left;
    const timelineX = surface.scrollLeft + viewportX - taskColumnWidth(surface);
    pendingZoomAnchor.current = {
      date: addDays(scale.start, Math.round(timelineX / scale.cellWidth)),
      viewportX,
    };
    onZoom(event.deltaY < 0 ? 1 : -1);
  }

  if (!rows.length)
    return (
      <section className="gantt-empty">
        <h2>No tasks match these controls</h2>
        <p>Change the project, search, or completed-task filter.</p>
      </section>
    );

  return (
    <section
      className={`gantt-frame${linkDrag ? " is-linking" : ""}`}
      aria-label="Task timeline"
    >
      <div className="gantt-scroll" ref={scroller} onWheel={handleWheel}>
        <div
          className="gantt-canvas"
          style={{ width: TASK_COLUMN + timelineWidth }}
        >
          <div className="gantt-corner">
            <span>Task</span>
            <span>Schedule</span>
          </div>
          <TimelineHeader scale={scale} width={timelineWidth} />
          <div className="gantt-body" ref={body} style={{ height: bodyHeight }}>
            {rows.map((row) =>
              row.kind === "group" ? (
                <GroupRow
                  cellWidth={scale.cellWidth}
                  key={row.id}
                  row={row}
                  timelineWidth={timelineWidth}
                />
              ) : (
                <TaskRow
                  cellWidth={scale.cellWidth}
                  key={row.id}
                  linkDrag={linkDrag}
                  preview={
                    schedulePreview?.taskId === row.task.id
                      ? schedulePreview.update
                      : undefined
                  }
                  row={row}
                  scaleStart={scale.start}
                  selected={selectedId === row.task.id}
                  suppressClickRef={suppressClick}
                  timelineWidth={timelineWidth}
                  onBeginLink={beginLink}
                  onBeginScheduleDrag={beginScheduleDrag}
                  onCancelLink={cancelLink}
                  onCancelScheduleDrag={cancelScheduleDrag}
                  onEndLink={endLink}
                  onEndScheduleDrag={endScheduleDrag}
                  onMoveLink={moveLink}
                  onMoveScheduleDrag={moveScheduleDrag}
                  onNudge={nudgeSchedule}
                  onSelect={onSelect}
                />
              ),
            )}
            <DependencyLayer
              bodyHeight={bodyHeight}
              cellWidth={scale.cellWidth}
              linkDrag={linkDrag}
              rows={rows}
              scaleStart={scale.start}
              timelineWidth={timelineWidth}
            />
            {todayX >= 0 && todayX <= timelineWidth ? (
              <div
                className="today-line"
                style={{ left: `calc(var(--task-column) + ${todayX}px)` }}
              >
                <span>Today</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {interactionMessage ? (
        <p
          className={`gantt-interaction-message is-${interactionMessage.tone}`}
          role={interactionMessage.tone === "danger" ? "alert" : "status"}
        >
          {interactionMessage.text}
        </p>
      ) : linkDrag ? (
        <p className="gantt-interaction-message" role="status">
          {linkDrag.invalidReason ??
            "Drop on a task edge to set the relationship"}
        </p>
      ) : null}
    </section>
  );
}

function TimelineHeader({
  scale,
  width,
}: {
  scale: ReturnType<typeof timelineScale>;
  width: number;
}) {
  const months = segmentDates(scale.days, (date) => date.slice(0, 7));
  const weekLabels = scale.days.flatMap((date, index) =>
    new Date(`${date}T00:00:00Z`).getUTCDay() === 1 ? [{ date, index }] : [],
  );
  return (
    <div className="timeline-header" style={{ left: TASK_COLUMN, width }}>
      <div className="month-row">
        {months.map((month) => (
          <span
            key={month.key}
            style={{
              left: month.start * scale.cellWidth,
              width: month.length * scale.cellWidth,
            }}
          >
            {dateLabel(month.date, {
              month: "long",
              year: "numeric",
              day: undefined,
            })}
          </span>
        ))}
      </div>
      <div className="date-row">
        {scale.days.map((date, index) => {
          const day = new Date(`${date}T00:00:00Z`).getUTCDay();
          return (
            <span
              className={day === 0 || day === 6 ? "weekend" : undefined}
              key={date}
              style={{ left: index * scale.cellWidth, width: scale.cellWidth }}
            >
              {scale.cellWidth >= 30 ? date.slice(8) : ""}
            </span>
          );
        })}
        {scale.cellWidth >= 8 && scale.cellWidth < 30
          ? weekLabels.map(({ date, index }) => (
              <b
                key={date}
                style={{
                  left: index * scale.cellWidth,
                  width: 7 * scale.cellWidth,
                }}
              >
                {dateLabel(date)}
              </b>
            ))
          : null}
      </div>
    </div>
  );
}

function GroupRow({
  row,
  timelineWidth,
  cellWidth,
}: {
  row: Extract<GanttRow, { kind: "group" }>;
  timelineWidth: number;
  cellWidth: number;
}) {
  return (
    <div className="gantt-row group-row" style={{ height: GROUP_HEIGHT }}>
      <div className="task-ledger group-ledger">
        <span>{row.label}</span>
        <small>{row.count}</small>
      </div>
      <div
        className="timeline-row"
        style={timelineRowStyle(cellWidth, timelineWidth)}
      />
    </div>
  );
}

function TaskRow({
  row,
  timelineWidth,
  scaleStart,
  cellWidth,
  selected,
  preview,
  linkDrag,
  suppressClickRef,
  onSelect,
  onBeginScheduleDrag,
  onMoveScheduleDrag,
  onEndScheduleDrag,
  onCancelScheduleDrag,
  onNudge,
  onBeginLink,
  onMoveLink,
  onEndLink,
  onCancelLink,
}: {
  row: Extract<GanttRow, { kind: "task" }>;
  timelineWidth: number;
  scaleStart: string;
  cellWidth: number;
  selected: boolean;
  preview?: ScheduleUpdate;
  linkDrag: LinkDrag | null;
  suppressClickRef: MutableRefObject<boolean>;
  onSelect(task: PlannerTask): void;
  onBeginScheduleDrag(
    event: ReactPointerEvent<HTMLElement>,
    task: PlannerTask,
    kind: ScheduleDragKind,
  ): void;
  onMoveScheduleDrag(event: { clientX: number }): void;
  onEndScheduleDrag(): void;
  onCancelScheduleDrag(): void;
  onNudge(
    task: PlannerTask,
    kind: Exclude<ScheduleDragKind, "place">,
    days: number,
  ): void;
  onBeginLink(
    event: ReactPointerEvent<HTMLButtonElement>,
    task: PlannerTask,
    edge: "start" | "finish",
  ): void;
  onMoveLink(event: ReactPointerEvent<HTMLButtonElement>): void;
  onEndLink(event: ReactPointerEvent<HTMLButtonElement>): void;
  onCancelLink(): void;
}) {
  const task = preview ? withSchedule(row.task, preview) : row.task;
  const existingSpan = taskSpan(row.task);
  const span = taskSpan(task);
  const startX = span ? daysBetween(scaleStart, span.start) * cellWidth : 0;
  const width = span
    ? Math.max(cellWidth, (daysBetween(span.start, span.end) + 1) * cellWidth)
    : 0;

  function select() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelect(row.task);
  }

  function keyboardMove(
    event: ReactKeyboardEvent,
    kind: Exclude<ScheduleDragKind, "place">,
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (kind === "move" && !event.altKey) return;
    event.preventDefault();
    onNudge(row.task, kind, event.key === "ArrowLeft" ? -1 : 1);
  }

  return (
    <div
      className={`gantt-row task-row${selected ? " is-selected" : ""}`}
      style={{ height: TASK_HEIGHT }}
    >
      <button className="task-ledger" type="button" onClick={select}>
        <span
          className={`completion-mark${row.task.completed ? " is-complete" : ""}`}
        >
          {row.task.completed ? <Check aria-hidden="true" size={12} /> : null}
        </span>
        <span className="ledger-title">
          <strong>{row.task.title}</strong>
          <small>{scheduleLabel(task)}</small>
        </span>
        {row.task.blockedBy.length ? (
          <GitBranch
            aria-label={`${row.task.blockedBy.length} dependencies`}
            size={14}
          />
        ) : null}
      </button>
      <div
        className="timeline-row"
        style={timelineRowStyle(cellWidth, timelineWidth)}
      >
        {existingSpan && span ? (
          <div
            className={`task-bar${span.milestone ? " is-milestone" : ""}${row.task.completed ? " is-complete" : ""}${preview ? " is-preview" : ""}`}
            style={
              span.milestone
                ? { left: startX + cellWidth / 2 }
                : { left: startX + 3, width: Math.max(8, width - 6) }
            }
          >
            <button
              aria-label={`${row.task.title}, ${span.milestone ? `due ${dateLabel(span.start)}` : `${dateLabel(span.start)} to ${dateLabel(span.end)}`}. Drag to move; Alt plus arrow keys also move by one day.`}
              className="task-bar-main"
              type="button"
              onClick={select}
              onKeyDown={(event) => keyboardMove(event, "move")}
              onPointerCancel={onCancelScheduleDrag}
              onPointerDown={(event) =>
                onBeginScheduleDrag(event, row.task, "move")
              }
              onPointerMove={onMoveScheduleDrag}
              onPointerUp={onEndScheduleDrag}
            >
              {!span.milestone && width > 80 ? (
                <span>{row.task.title}</span>
              ) : null}
            </button>
            {!span.milestone ? (
              <>
                <button
                  aria-label={`Change ${row.task.title} scheduled date`}
                  className="resize-grip is-start"
                  type="button"
                  onKeyDown={(event) => keyboardMove(event, "resize-start")}
                  onPointerCancel={onCancelScheduleDrag}
                  onPointerDown={(event) =>
                    onBeginScheduleDrag(event, row.task, "resize-start")
                  }
                  onPointerMove={onMoveScheduleDrag}
                  onPointerUp={onEndScheduleDrag}
                />
                <button
                  aria-label={`Change ${row.task.title} due date`}
                  className="resize-grip is-finish"
                  type="button"
                  onKeyDown={(event) => keyboardMove(event, "resize-finish")}
                  onPointerCancel={onCancelScheduleDrag}
                  onPointerDown={(event) =>
                    onBeginScheduleDrag(event, row.task, "resize-finish")
                  }
                  onPointerMove={onMoveScheduleDrag}
                  onPointerUp={onEndScheduleDrag}
                />
              </>
            ) : null}
            {!span.milestone ? (
              <LinkPort
                edge="start"
                linkDrag={linkDrag}
                task={row.task}
                onBegin={onBeginLink}
                onCancel={onCancelLink}
                onEnd={onEndLink}
                onMove={onMoveLink}
              />
            ) : null}
            <LinkPort
              edge="finish"
              linkDrag={linkDrag}
              task={row.task}
              onBegin={onBeginLink}
              onCancel={onCancelLink}
              onEnd={onEndLink}
              onMove={onMoveLink}
            />
          </div>
        ) : (
          <>
            <button
              className={`unscheduled-row-action${preview ? " is-preview" : ""}`}
              type="button"
              onClick={select}
              onPointerCancel={onCancelScheduleDrag}
              onPointerDown={(event) =>
                onBeginScheduleDrag(event, row.task, "place")
              }
              onPointerMove={onMoveScheduleDrag}
              onPointerUp={onEndScheduleDrag}
            >
              <Minus aria-hidden="true" size={14} />
              {preview ? "Drop to schedule" : "Drag to schedule"}
            </button>
            {span ? (
              <div
                aria-hidden="true"
                className="task-bar is-preview is-placement-preview"
                style={{ left: startX + 3, width: Math.max(8, width - 6) }}
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function LinkPort({
  task,
  edge,
  linkDrag,
  onBegin,
  onMove,
  onEnd,
  onCancel,
}: {
  task: PlannerTask;
  edge: "start" | "finish";
  linkDrag: LinkDrag | null;
  onBegin(
    event: ReactPointerEvent<HTMLButtonElement>,
    task: PlannerTask,
    edge: "start" | "finish",
  ): void;
  onMove(event: ReactPointerEvent<HTMLButtonElement>): void;
  onEnd(event: ReactPointerEvent<HTMLButtonElement>): void;
  onCancel(): void;
}) {
  const targeted =
    linkDrag?.targetId === task.id && linkDrag.targetEdge === edge;
  return (
    <button
      aria-label={`${edge === "start" ? "Start" : "Finish"} relationship handle for ${task.title}`}
      className={`link-port is-${edge}${targeted ? " is-targeted" : ""}${targeted && linkDrag?.invalidReason ? " is-invalid" : ""}`}
      data-edge={edge}
      data-task-id={task.id}
      type="button"
      onPointerCancel={onCancel}
      onPointerDown={(event) => onBegin(event, task, edge)}
      onPointerMove={onMove}
      onPointerUp={onEnd}
    />
  );
}

function DependencyLayer({
  rows,
  scaleStart,
  cellWidth,
  timelineWidth,
  bodyHeight,
  linkDrag,
}: {
  rows: readonly GanttRow[];
  scaleStart: string;
  cellWidth: number;
  timelineWidth: number;
  bodyHeight: number;
  linkDrag: LinkDrag | null;
}) {
  let offset = 0;
  const taskY = new Map<string, number>();
  const tasks = new Map<string, PlannerTask>();
  for (const row of rows) {
    const height = row.kind === "group" ? GROUP_HEIGHT : TASK_HEIGHT;
    if (row.kind === "task") {
      taskY.set(row.task.id, offset + height / 2);
      tasks.set(row.task.id, row.task);
    }
    offset += height;
  }
  const paths: Array<{ key: string; d: string }> = [];
  for (const row of rows) {
    if (row.kind !== "task") continue;
    const targetSpan = taskSpan(row.task);
    const targetY = taskY.get(row.task.id);
    if (!targetSpan || targetY === undefined) continue;
    for (const dependency of row.task.blockedBy) {
      const source = resolveDependencyTask([...tasks.values()], dependency.uid);
      const sourceSpan = source ? taskSpan(source) : null;
      const sourceY = source ? taskY.get(source.id) : undefined;
      if (!sourceSpan || sourceY === undefined) continue;
      const fromStart =
        dependency.reltype === "STARTTOSTART" ||
        dependency.reltype === "STARTTOFINISH";
      const toEnd =
        dependency.reltype === "FINISHTOFINISH" ||
        dependency.reltype === "STARTTOFINISH";
      const x1 =
        (daysBetween(
          scaleStart,
          fromStart ? sourceSpan.start : sourceSpan.end,
        ) +
          (fromStart ? 0 : 1)) *
        cellWidth;
      const x2 =
        (daysBetween(scaleStart, toEnd ? targetSpan.end : targetSpan.start) +
          (toEnd ? 1 : 0)) *
        cellWidth;
      paths.push({
        key: `${dependency.uid}-${row.task.id}-${dependency.reltype}`,
        d: dependencyPath(x1, sourceY, x2, targetY),
      });
    }
  }
  return (
    <svg
      aria-hidden="true"
      className="dependency-layer"
      height={bodyHeight}
      style={{ left: "var(--task-column)" }}
      viewBox={`0 0 ${timelineWidth} ${bodyHeight}`}
      width={timelineWidth}
    >
      <defs>
        <marker
          id="dependency-arrow"
          markerHeight="5"
          markerWidth="5"
          orient="auto"
          refX="4"
          refY="2.5"
        >
          <path d="M0,0 L5,2.5 L0,5 z" />
        </marker>
      </defs>
      {paths.map((path) => (
        <path d={path.d} key={path.key} markerEnd="url(#dependency-arrow)" />
      ))}
      {linkDrag ? (
        <path
          className={`link-preview${linkDrag.invalidReason ? " is-invalid" : ""}`}
          d={dependencyPath(
            linkDrag.startX,
            linkDrag.startY,
            linkDrag.currentX,
            linkDrag.currentY,
          )}
          markerEnd="url(#dependency-arrow)"
        />
      ) : null}
    </svg>
  );
}

function scheduleLabel(task: PlannerTask): string {
  const span = taskSpan(task);
  if (!span) return "Not scheduled";
  return span.milestone
    ? `Due ${dateLabel(span.start)}`
    : `${dateLabel(span.start)} — ${dateLabel(span.end)}`;
}

function timelineRowStyle(
  cellWidth: number,
  timelineWidth: number,
): CSSProperties {
  return {
    "--cell-width": `${cellWidth}px`,
    width: timelineWidth,
  } as CSSProperties;
}

function dependencyPath(x1: number, y1: number, x2: number, y2: number) {
  const bend = Math.max(14, Math.min(42, Math.abs(x2 - x1) / 2));
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function taskColumnWidth(surface: HTMLElement): number {
  const canvas = surface.querySelector<HTMLElement>(".gantt-canvas");
  const value = canvas
    ? getComputedStyle(canvas).getPropertyValue("--task-column")
    : "";
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : TASK_COLUMN;
}

function segmentDates(
  days: readonly string[],
  keyForDate: (date: string) => string,
): Array<{ key: string; date: string; start: number; length: number }> {
  const segments: Array<{
    key: string;
    date: string;
    start: number;
    length: number;
  }> = [];
  for (const [index, date] of days.entries()) {
    const key = keyForDate(date);
    const current = segments.at(-1);
    if (current?.key === key) current.length += 1;
    else segments.push({ key, date, start: index, length: 1 });
  }
  return segments;
}
