import type { PlannerTask } from "./task";

export type TimelineZoom = "day" | "week" | "month";

export interface TaskSpan {
  start: string;
  end: string;
  milestone: boolean;
}

export interface TimelineScale {
  start: string;
  end: string;
  days: string[];
  cellWidth: number;
}

export type GanttRow =
  | { kind: "group"; id: string; label: string; count: number }
  | { kind: "task"; id: string; groupId: string; task: PlannerTask };

const DAY_MS = 86_400_000;

export function datePart(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^\d{4}-\d{2}-\d{2}/.exec(value);
  return match?.[0];
}

export function taskSpan(task: PlannerTask): TaskSpan | null {
  const scheduled = datePart(task.scheduled);
  const due = datePart(task.due);
  if (!scheduled && !due) return null;
  if (!scheduled && due) return { start: due, end: due, milestone: true };
  const start = scheduled ?? due!;
  const end = due && compareDates(due, start) >= 0 ? due : start;
  return { start, end, milestone: false };
}

export function timelineScale(
  tasks: readonly PlannerTask[],
  zoom: TimelineZoom,
  today = dateFromDate(new Date()),
): TimelineScale {
  const dates = tasks.flatMap((task) => {
    const span = taskSpan(task);
    return span ? [span.start, span.end] : [];
  });
  const bounds = zoomBounds(zoom);
  const earliest = dates.reduce(
    (value, date) => (compareDates(date, value) < 0 ? date : value),
    addDays(today, -bounds.before),
  );
  const latest = dates.reduce(
    (value, date) => (compareDates(date, value) > 0 ? date : value),
    addDays(today, bounds.after),
  );
  const start = startOfWeek(addDays(earliest, -7));
  const end = addDays(latest, 21);
  return {
    start,
    end,
    days: dateSequence(start, end),
    cellWidth: bounds.cellWidth,
  };
}

export function groupTasks(tasks: readonly PlannerTask[]): GanttRow[] {
  const groups = new Map<string, { label: string; tasks: PlannerTask[] }>();
  for (const task of tasks) {
    const raw = task.projects[0];
    const label = raw ? projectLabel(raw) : "No project";
    const key = raw ? `project:${label.toLocaleLowerCase()}` : "unassigned";
    const group = groups.get(key) ?? { label, tasks: [] };
    group.tasks.push(task);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      if (leftKey === "unassigned") return 1;
      if (rightKey === "unassigned") return -1;
      return left.label.localeCompare(right.label);
    })
    .flatMap(([id, group]) => [
      {
        kind: "group" as const,
        id,
        label: group.label,
        count: group.tasks.length,
      },
      ...group.tasks
        .sort((left, right) => {
          const leftDate = taskSpan(left)?.start ?? "9999-12-31";
          const rightDate = taskSpan(right)?.start ?? "9999-12-31";
          return (
            compareDates(leftDate, rightDate) ||
            left.title.localeCompare(right.title)
          );
        })
        .map((task) => ({
          kind: "task" as const,
          id: task.id,
          groupId: id,
          task,
        })),
    ]);
}

export function projectLabel(value: string): string {
  const unwrapped = value
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")
    .at(-1)!
    .replace(/\.md$/i, "");
  return unwrapped.split("/").at(-1) ?? unwrapped;
}

export function addDays(value: string, days: number): string {
  return dateFromMs(dateMs(value) + days * DAY_MS);
}

export function daysBetween(left: string, right: string): number {
  return Math.round((dateMs(right) - dateMs(left)) / DAY_MS);
}

export function startOfWeek(value: string): string {
  const date = new Date(dateMs(value));
  const day = date.getUTCDay();
  return addDays(value, -(day === 0 ? 6 : day - 1));
}

export function dateFromDate(value: Date): string {
  return dateFromMs(
    Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
  );
}

export function dateLabel(
  value: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...options,
  }).format(new Date(dateMs(value)));
}

function zoomBounds(zoom: TimelineZoom) {
  if (zoom === "day") return { before: 21, after: 42, cellWidth: 34 };
  if (zoom === "week") return { before: 42, after: 98, cellWidth: 15 };
  return { before: 92, after: 274, cellWidth: 6 };
}

function dateSequence(start: string, end: string): string[] {
  const count = Math.max(1, daysBetween(start, end) + 1);
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

function compareDates(left: string, right: string): number {
  return left.localeCompare(right);
}

function dateMs(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dateFromMs(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}
