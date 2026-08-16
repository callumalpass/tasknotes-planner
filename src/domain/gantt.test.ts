import {
  addDays,
  canAddDependency,
  dependencyRelationship,
  groupTasks,
  replaceDatePart,
  replaceDateAndTime,
  resizedSchedule,
  resizedScheduleAt,
  shiftedSchedule,
  shiftedScheduleByMinutes,
  taskTimelineSpan,
  taskSpan,
  timelineScale,
} from "./gantt";

import type { PlannerTask } from "./task";

const task = (input: Partial<PlannerTask> = {}): PlannerTask => ({
  id: input.id ?? "task-1",
  path: input.path ?? "tasks/Task.md",
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

describe("taskSpan", () => {
  it("uses scheduled and due as an inclusive planning range", () => {
    expect(
      taskSpan(task({ scheduled: "2026-08-17T09:00:00", due: "2026-08-20" })),
    ).toEqual({
      start: "2026-08-17",
      end: "2026-08-20",
      milestone: false,
    });
  });

  it("renders a due-only task as a milestone", () => {
    expect(taskSpan(task({ due: "2026-08-20" }))).toEqual({
      start: "2026-08-20",
      end: "2026-08-20",
      milestone: true,
    });
  });

  it("keeps an invalid reverse range on the scheduled day", () => {
    expect(
      taskSpan(task({ scheduled: "2026-08-20", due: "2026-08-17" })),
    ).toEqual({
      start: "2026-08-20",
      end: "2026-08-20",
      milestone: false,
    });
  });
});

describe("timelineScale", () => {
  it("includes task dates and a useful horizon around today", () => {
    const scale = timelineScale(
      [task({ scheduled: "2026-07-01", due: "2027-01-15" })],
      3,
      "2026-08-16",
    );
    expect(scale.start <= "2026-07-01").toBe(true);
    expect(scale.end >= "2027-01-15").toBe(true);
    expect(scale.cellWidth).toBe(15);
    expect(scale.days.at(-1)).toBe(scale.end);
  });

  it("provides hour and quarter-hour intraday scales", () => {
    const hourly = timelineScale([], 6, "2026-08-16");
    const quarterHourly = timelineScale([], 7, "2026-08-16");
    expect(hourly).toMatchObject({
      cellWidth: 240,
      intraday: true,
      snapMinutes: 60,
    });
    expect(quarterHourly).toMatchObject({
      cellWidth: 576,
      intraday: true,
      snapMinutes: 15,
    });
  });
});

describe("schedule manipulation", () => {
  it("preserves TaskNotes time suffixes when replacing a date", () => {
    expect(replaceDatePart("2026-08-17T09:30:00+10:00", "2026-08-19")).toBe(
      "2026-08-19T09:30:00+10:00",
    );
  });

  it("moves both ends of a task by calendar days", () => {
    expect(
      shiftedSchedule(
        task({
          scheduled: "2026-08-17T09:30:00+10:00",
          due: "2026-08-20",
        }),
        2,
      ),
    ).toEqual({
      scheduled: "2026-08-19T09:30:00+10:00",
      due: "2026-08-22",
    });
  });

  it("does not let a resized edge cross the other edge", () => {
    expect(
      resizedSchedule(
        task({ scheduled: "2026-08-17", due: "2026-08-20" }),
        "start",
        "2026-08-24",
      ),
    ).toEqual({ scheduled: "2026-08-20", due: "2026-08-20" });
  });

  it("positions timed tasks within a day and preserves timestamp suffixes", () => {
    const timed = task({
      scheduled: "2026-08-17T09:30:00+10:00",
      due: "2026-08-17T11:00:00+10:00",
    });
    const span = taskTimelineSpan(timed, 15)!;
    expect(span.endMinute - span.startMinute).toBe(90);
    expect(
      taskTimelineSpan(timed, 24 * 60)!.endMinute -
        taskTimelineSpan(timed, 24 * 60)!.startMinute,
    ).toBe(90);
    expect(shiftedScheduleByMinutes(timed, 45)).toEqual({
      scheduled: "2026-08-17T10:15:00+10:00",
      due: "2026-08-17T11:45:00+10:00",
    });
    expect(
      resizedScheduleAt(timed, "finish", span.startMinute + 15, 15),
    ).toMatchObject({ due: "2026-08-17T09:45:00+10:00" });
  });

  it("keeps date-only tasks all-day at intraday scales", () => {
    const allDay = task({ scheduled: "2026-08-17", due: "2026-08-18" });
    const span = taskTimelineSpan(allDay, 15)!;
    expect(span.endMinute - span.startMinute).toBe(2 * 24 * 60);
    expect(shiftedScheduleByMinutes(allDay, 3 * 60)).toEqual({
      scheduled: "2026-08-17",
      due: "2026-08-18",
    });
  });

  it("adds or removes explicit time while preserving timestamp precision", () => {
    expect(replaceDateAndTime(undefined, "2026-08-17", "09:30")).toBe(
      "2026-08-17T09:30:00",
    );
    expect(
      replaceDateAndTime("2026-08-17T08:00:30+10:00", "2026-08-18", "10:15"),
    ).toBe("2026-08-18T10:15:30+10:00");
    expect(
      replaceDateAndTime("2026-08-17T08:00:30+10:00", "2026-08-18", ""),
    ).toBe("2026-08-18");
  });
});

describe("dependency editing", () => {
  const research = task({
    id: "research",
    path: "tasks/Research.md",
    title: "Research",
  });
  const prototype = task({
    id: "prototype",
    path: "tasks/Prototype.md",
    title: "Prototype",
    blockedBy: [{ uid: "[[tasks/Research.md]]", reltype: "FINISHTOSTART" }],
  });

  it("rejects self-links and cycles, including path-based links", () => {
    expect(
      canAddDependency([research, prototype], "research", "research"),
    ).toMatchObject({ allowed: false });
    expect(
      canAddDependency([research, prototype], "prototype", "research"),
    ).toMatchObject({
      allowed: false,
      reason: expect.stringContaining("cycle"),
    });
  });

  it("maps dragged bar edges to TaskNotes relationship types", () => {
    expect(dependencyRelationship("finish", "start")).toBe("FINISHTOSTART");
    expect(dependencyRelationship("start", "start")).toBe("STARTTOSTART");
    expect(dependencyRelationship("finish", "finish")).toBe("FINISHTOFINISH");
    expect(dependencyRelationship("start", "finish")).toBe("STARTTOFINISH");
  });
});

describe("groupTasks", () => {
  it("groups by the first project and keeps unscheduled work last", () => {
    const rows = groupTasks([
      task({ id: "2", title: "Later", projects: ["[[projects/Launch]]"] }),
      task({
        id: "1",
        title: "First",
        projects: ["[[projects/Launch]]"],
        scheduled: "2026-08-18",
      }),
      task({ id: "3", title: "Loose" }),
    ]);
    expect(
      rows.map((row) => (row.kind === "group" ? row.label : row.task.title)),
    ).toEqual(["Launch", "First", "Later", "No project", "Loose"]);
  });
});

describe("addDays", () => {
  it("uses calendar days across daylight-saving boundaries", () => {
    expect(addDays("2026-10-03", 1)).toBe("2026-10-04");
  });
});
