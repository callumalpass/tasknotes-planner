import { Check, GitBranch, Minus } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import type { CSSProperties } from "react";

import {
  dateFromDate,
  dateLabel,
  daysBetween,
  groupTasks,
  taskSpan,
  timelineScale,
  type GanttRow,
  type TimelineZoom,
} from "../domain/gantt";

import type { PlannerTask } from "../domain/task";

const TASK_COLUMN = 350;
const GROUP_HEIGHT = 35;
const TASK_HEIGHT = 49;

export function GanttChart({
  tasks,
  zoom,
  selectedId,
  todayRequest,
  onSelect,
}: {
  tasks: readonly PlannerTask[];
  zoom: TimelineZoom;
  selectedId: string | null;
  todayRequest: number;
  onSelect(task: PlannerTask): void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const today = dateFromDate(new Date());
  const scale = useMemo(
    () => timelineScale(tasks, zoom, today),
    [tasks, today, zoom],
  );
  const rows = useMemo(() => groupTasks(tasks), [tasks]);
  const timelineWidth = scale.days.length * scale.cellWidth;
  const bodyHeight = rows.reduce(
    (height, row) =>
      height + (row.kind === "group" ? GROUP_HEIGHT : TASK_HEIGHT),
    0,
  );
  const todayX = daysBetween(scale.start, today) * scale.cellWidth;

  useEffect(() => {
    const surface = scroller.current;
    if (!surface) return;
    const taskColumn = surface.clientWidth <= 560 ? 280 : TASK_COLUMN;
    const left = Math.max(0, taskColumn + todayX - surface.clientWidth * 0.55);
    surface.scrollTo({ left, behavior: todayRequest ? "smooth" : "auto" });
  }, [scale.start, todayRequest, todayX, zoom]);

  if (!rows.length)
    return (
      <section className="gantt-empty">
        <h2>No tasks match these controls</h2>
        <p>Change the project, search, or completed-task filter.</p>
      </section>
    );

  return (
    <section className="gantt-frame" aria-label="Task timeline">
      <div className="gantt-scroll" ref={scroller}>
        <div
          className="gantt-canvas"
          style={{ width: TASK_COLUMN + timelineWidth }}
        >
          <div className="gantt-corner">
            <span>Task</span>
            <span>Schedule</span>
          </div>
          <TimelineHeader scale={scale} width={timelineWidth} />
          <div className="gantt-body" style={{ height: bodyHeight }}>
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
                  key={row.id}
                  row={row}
                  scaleStart={scale.start}
                  cellWidth={scale.cellWidth}
                  selected={selectedId === row.task.id}
                  timelineWidth={timelineWidth}
                  onSelect={onSelect}
                />
              ),
            )}
            <DependencyLayer
              bodyHeight={bodyHeight}
              cellWidth={scale.cellWidth}
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
          const show = scale.cellWidth >= 30 || day === 1;
          return (
            <span
              className={day === 0 || day === 6 ? "weekend" : undefined}
              key={date}
              style={{ left: index * scale.cellWidth, width: scale.cellWidth }}
            >
              {show
                ? scale.cellWidth >= 30
                  ? date.slice(8)
                  : dateLabel(date)
                : ""}
            </span>
          );
        })}
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
        style={
          {
            "--cell-width": `${cellWidth}px`,
            width: timelineWidth,
          } as CSSProperties
        }
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
  onSelect,
}: {
  row: Extract<GanttRow, { kind: "task" }>;
  timelineWidth: number;
  scaleStart: string;
  cellWidth: number;
  selected: boolean;
  onSelect(task: PlannerTask): void;
}) {
  const span = taskSpan(row.task);
  const startX = span ? daysBetween(scaleStart, span.start) * cellWidth : 0;
  const width = span
    ? Math.max(cellWidth, (daysBetween(span.start, span.end) + 1) * cellWidth)
    : 0;
  return (
    <div
      className={`gantt-row task-row${selected ? " is-selected" : ""}`}
      style={{ height: TASK_HEIGHT }}
    >
      <button
        className="task-ledger"
        type="button"
        onClick={() => onSelect(row.task)}
      >
        <span
          className={`completion-mark${row.task.completed ? " is-complete" : ""}`}
        >
          {row.task.completed ? <Check aria-hidden="true" size={12} /> : null}
        </span>
        <span className="ledger-title">
          <strong>{row.task.title}</strong>
          <small>
            {span
              ? span.milestone
                ? `Due ${dateLabel(span.start)}`
                : `${dateLabel(span.start)} — ${dateLabel(span.end)}`
              : "Not scheduled"}
          </small>
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
        style={
          {
            "--cell-width": `${cellWidth}px`,
            width: timelineWidth,
          } as CSSProperties
        }
      >
        {span ? (
          <button
            aria-label={`${row.task.title}, ${span.milestone ? `due ${dateLabel(span.start)}` : `${dateLabel(span.start)} to ${dateLabel(span.end)}`}`}
            className={`task-bar${span.milestone ? " is-milestone" : ""}${row.task.completed ? " is-complete" : ""}`}
            style={
              span.milestone
                ? { left: startX + cellWidth / 2 }
                : { left: startX + 3, width: Math.max(8, width - 6) }
            }
            type="button"
            onClick={() => onSelect(row.task)}
          >
            {!span.milestone && width > 80 ? (
              <span>{row.task.title}</span>
            ) : null}
          </button>
        ) : (
          <button
            className="unscheduled-row-action"
            type="button"
            onClick={() => onSelect(row.task)}
          >
            <Minus aria-hidden="true" size={14} />
            Set dates
          </button>
        )}
      </div>
    </div>
  );
}

function DependencyLayer({
  rows,
  scaleStart,
  cellWidth,
  timelineWidth,
  bodyHeight,
}: {
  rows: readonly GanttRow[];
  scaleStart: string;
  cellWidth: number;
  timelineWidth: number;
  bodyHeight: number;
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
      const source = tasks.get(dependency.uid);
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
      const bend = Math.max(14, Math.min(42, Math.abs(x2 - x1) / 2));
      paths.push({
        key: `${dependency.uid}-${row.task.id}-${dependency.reltype}`,
        d: `M ${x1} ${sourceY} C ${x1 + bend} ${sourceY}, ${x2 - bend} ${targetY}, ${x2} ${targetY}`,
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
    </svg>
  );
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
