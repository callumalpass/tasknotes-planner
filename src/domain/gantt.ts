import { hasTimeComponent } from "@tasknotes/model/date";

import type {
  PlannerTask,
  ScheduleUpdate,
  TaskDependency,
  TaskDependencyRelType,
} from "./task";

export const TIMELINE_ZOOMS = [
  {
    label: "Quarters",
    cellWidth: 3,
    before: 184,
    after: 548,
    snapMinutes: 1440,
    intraday: false,
  },
  {
    label: "Months",
    cellWidth: 6,
    before: 92,
    after: 274,
    snapMinutes: 1440,
    intraday: false,
  },
  {
    label: "Fortnights",
    cellWidth: 10,
    before: 63,
    after: 154,
    snapMinutes: 1440,
    intraday: false,
  },
  {
    label: "Weeks",
    cellWidth: 15,
    before: 42,
    after: 98,
    snapMinutes: 1440,
    intraday: false,
  },
  {
    label: "Work weeks",
    cellWidth: 22,
    before: 32,
    after: 70,
    snapMinutes: 1440,
    intraday: false,
  },
  {
    label: "Days",
    cellWidth: 34,
    before: 21,
    after: 42,
    snapMinutes: 1440,
    intraday: false,
  },
  {
    label: "Hours",
    cellWidth: 240,
    before: 3,
    after: 7,
    snapMinutes: 60,
    intraday: true,
  },
  {
    label: "Quarter hours",
    cellWidth: 576,
    before: 1,
    after: 3,
    snapMinutes: 15,
    intraday: true,
  },
] as const;

export type TimelineZoom = number;

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
  snapMinutes: number;
  intraday: boolean;
}

export interface TimelineTaskSpan {
  startMinute: number;
  endMinute: number;
  milestone: boolean;
  timed: boolean;
}

export type GanttRow =
  | { kind: "group"; id: string; label: string; count: number }
  | { kind: "task"; id: string; groupId: string; task: PlannerTask };

const DAY_MS = 86_400_000;
export const DAY_MINUTES = 1_440;

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
  const bounds = zoomDefinition(zoom);
  const earliest = dates.reduce(
    (value, date) => (compareDates(date, value) < 0 ? date : value),
    addDays(today, -bounds.before),
  );
  const latest = dates.reduce(
    (value, date) => (compareDates(date, value) > 0 ? date : value),
    addDays(today, bounds.after),
  );
  const start = bounds.intraday
    ? addDays(earliest, -1)
    : startOfWeek(addDays(earliest, -7));
  const end = addDays(latest, bounds.intraday ? 1 : 21);
  return {
    start,
    end,
    days: dateSequence(start, end),
    cellWidth: bounds.cellWidth,
    snapMinutes: bounds.snapMinutes,
    intraday: bounds.intraday,
  };
}

export function clampZoom(value: number): TimelineZoom {
  return Math.max(0, Math.min(TIMELINE_ZOOMS.length - 1, Math.round(value)));
}

export function zoomDefinition(zoom: TimelineZoom) {
  return TIMELINE_ZOOMS[clampZoom(zoom)];
}

export function replaceDatePart(
  original: string | undefined,
  date: string,
): string {
  const originalDate = datePart(original);
  return originalDate ? `${date}${original!.slice(originalDate.length)}` : date;
}

export function timePart(value: string | undefined): string {
  if (!hasTimeComponent(value)) return "";
  return /T(\d{2}:\d{2})/.exec(value!)?.[1] ?? "";
}

export function replaceDateAndTime(
  original: string | undefined,
  date: string,
  time: string,
): string {
  if (!time) return date;
  const existing = original?.match(/^\d{4}-\d{2}-\d{2}([T ])\d{2}:\d{2}(.*)$/);
  return `${date}${existing?.[1] ?? "T"}${time}${existing?.[2] || ":00"}`;
}

export function planningMinute(
  value: string | undefined,
  bound: "start" | "end" = "start",
): number | undefined {
  const date = datePart(value);
  if (!date) return undefined;
  const time = timePart(value);
  const minute = time
    ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
    : bound === "end"
      ? DAY_MINUTES
      : 0;
  return dateMs(date) / 60_000 + minute;
}

export function minuteToPlanningValue(
  minute: number,
  original: string | undefined,
  timed = true,
): string {
  const day = Math.floor(minute / DAY_MINUTES);
  const minuteOfDay = minute - day * DAY_MINUTES;
  const date = dateFromMs(day * DAY_MS);
  if (!timed) return date;
  const hours = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const minutes = String(minuteOfDay % 60).padStart(2, "0");
  return replaceDateAndTime(original, date, `${hours}:${minutes}`);
}

export function taskHasTime(task: PlannerTask): boolean {
  return hasTimeComponent(task.scheduled) || hasTimeComponent(task.due);
}

export function taskTimelineSpan(
  task: PlannerTask,
  snapMinutes: number,
): TimelineTaskSpan | null {
  const scheduled = planningMinute(task.scheduled, "start");
  const due = planningMinute(task.due, "end");
  const timed = taskHasTime(task);
  if (scheduled === undefined && due === undefined) return null;
  if (scheduled === undefined && due !== undefined) {
    const point = hasTimeComponent(task.due) ? due : due - DAY_MINUTES / 2;
    return {
      startMinute: point,
      endMinute: point,
      milestone: true,
      timed,
    };
  }
  const defaultDuration = hasTimeComponent(task.scheduled)
    ? snapMinutes
    : DAY_MINUTES;
  return {
    startMinute: scheduled!,
    endMinute:
      due === undefined
        ? scheduled! + defaultDuration
        : Math.max(scheduled! + (timed ? 1 : snapMinutes), due),
    milestone: false,
    timed,
  };
}

export function shiftedScheduleByMinutes(
  task: PlannerTask,
  minutes: number,
): ScheduleUpdate {
  const timed = taskHasTime(task);
  const delta = timed
    ? minutes
    : Math.round(minutes / DAY_MINUTES) * DAY_MINUTES;
  function shift(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const minute = planningMinute(value, "start")!;
    return minuteToPlanningValue(
      minute + delta,
      value,
      hasTimeComponent(value),
    );
  }
  return { scheduled: shift(task.scheduled), due: shift(task.due) };
}

export function resizedScheduleAt(
  task: PlannerTask,
  edge: "start" | "finish",
  minute: number,
  snapMinutes: number,
): ScheduleUpdate {
  const span = taskTimelineSpan(task, snapMinutes);
  if (!span)
    return {
      scheduled: minuteToPlanningValue(
        minute,
        undefined,
        snapMinutes < DAY_MINUTES,
      ),
    };
  if (!span.timed) {
    return resizedSchedule(
      task,
      edge,
      minuteToPlanningValue(minute, undefined, false),
    );
  }
  if (span.milestone)
    return {
      scheduled: undefined,
      due: minuteToPlanningValue(minute, task.due, true),
    };
  if (edge === "start") {
    const clamped = Math.min(minute, span.endMinute - snapMinutes);
    return {
      scheduled: minuteToPlanningValue(clamped, task.scheduled, true),
      due: task.due,
    };
  }
  const clamped = Math.max(minute, span.startMinute + snapMinutes);
  return {
    scheduled: task.scheduled,
    due: minuteToPlanningValue(clamped, task.due, true),
  };
}

export function shiftedSchedule(
  task: PlannerTask,
  days: number,
): ScheduleUpdate {
  return shiftedScheduleByMinutes(task, days * DAY_MINUTES);
}

export function resizedSchedule(
  task: PlannerTask,
  edge: "start" | "finish",
  date: string,
): ScheduleUpdate {
  const span = taskSpan(task);
  if (!span) return { scheduled: date };
  if (span.milestone)
    return { due: replaceDatePart(task.due, date), scheduled: undefined };
  if (edge === "start") {
    const clamped = date > span.end ? span.end : date;
    return {
      scheduled: replaceDatePart(task.scheduled, clamped),
      due: task.due,
    };
  }
  const clamped = date < span.start ? span.start : date;
  return {
    scheduled: task.scheduled,
    due: replaceDatePart(task.due, clamped),
  };
}

export function withSchedule(
  task: PlannerTask,
  update: ScheduleUpdate,
): PlannerTask {
  return { ...task, scheduled: update.scheduled, due: update.due };
}

export function dependencyRelationship(
  source: "start" | "finish",
  target: "start" | "finish",
): TaskDependencyRelType {
  if (source === "start" && target === "start") return "STARTTOSTART";
  if (source === "start" && target === "finish") return "STARTTOFINISH";
  if (source === "finish" && target === "finish") return "FINISHTOFINISH";
  return "FINISHTOSTART";
}

export function canAddDependency(
  tasks: readonly PlannerTask[],
  sourceId: string,
  targetId: string,
): { allowed: true } | { allowed: false; reason: string } {
  if (sourceId === targetId)
    return { allowed: false, reason: "A task cannot depend on itself." };
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (!byId.has(sourceId) || !byId.has(targetId))
    return { allowed: false, reason: "The relationship task is not visible." };
  const blocking = new Map<string, string[]>();
  for (const task of tasks)
    for (const dependency of task.blockedBy) {
      const source = resolveDependencyTask(tasks, dependency.uid);
      if (!source) continue;
      const values = blocking.get(source.id) ?? [];
      values.push(task.id);
      blocking.set(source.id, values);
    }
  const pending = [targetId];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === sourceId)
      return {
        allowed: false,
        reason: "This relationship would create a cycle.",
      };
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(blocking.get(current) ?? []));
  }
  return { allowed: true };
}

export function resolveDependencyTask(
  tasks: readonly PlannerTask[],
  uid: string,
): PlannerTask | undefined {
  const normalized = normalizeTaskIdentity(uid);
  return tasks.find(
    (task) =>
      task.id === uid ||
      task.path === uid ||
      normalizeTaskIdentity(task.path) === normalized,
  );
}

export function dependencyReferencesTask(
  tasks: readonly PlannerTask[],
  dependency: TaskDependency,
  task: PlannerTask,
): boolean {
  return resolveDependencyTask(tasks, dependency.uid)?.id === task.id;
}

export function addOrReplaceDependency(
  dependencies: readonly TaskDependency[],
  sourceId: string,
  reltype: TaskDependencyRelType,
  tasks: readonly PlannerTask[] = [],
): TaskDependency[] {
  const next = dependencies.filter((dependency) => {
    if (dependency.uid === sourceId) return false;
    return tasks.length
      ? resolveDependencyTask(tasks, dependency.uid)?.id !== sourceId
      : true;
  });
  return [...next, { uid: sourceId, reltype }];
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

function normalizeTaskIdentity(value: string): string {
  return value
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|")[0]
    .replace(/\.md$/i, "")
    .toLocaleLowerCase();
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
