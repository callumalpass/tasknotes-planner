import { addDays, dateFromDate } from "../domain/gantt";

import type {
  PlannerCollection,
  PlannerRepository,
  PlannerTask,
  ScheduleUpdate,
} from "../domain/task";

export class DemoPlannerRepository implements PlannerRepository {
  private readonly collection: PlannerCollection;

  constructor(today = dateFromDate(new Date())) {
    this.collection = {
      id: "demo-planning",
      name: "Product planning",
      tasks: demoTasks(today),
    };
  }

  async load(): Promise<PlannerCollection> {
    return structuredClone(this.collection);
  }

  async updateSchedule(
    task: PlannerTask,
    update: ScheduleUpdate,
  ): Promise<PlannerTask> {
    const saved = { ...task, ...update };
    const index = this.collection.tasks.findIndex(
      (candidate) => candidate.id === task.id,
    );
    if (index >= 0) this.collection.tasks[index] = saved;
    return structuredClone(saved);
  }
}

function demoTasks(today: string): PlannerTask[] {
  const values: Array<
    Omit<
      PlannerTask,
      "path" | "status" | "priority" | "projects" | "blockedBy" | "completed"
    > &
      Partial<PlannerTask>
  > = [
    {
      id: "brief",
      title: "Shape the planning brief",
      scheduled: addDays(today, -12),
      due: addDays(today, -8),
      projects: ["[[Product planning]]"],
      completed: true,
    },
    {
      id: "research",
      title: "Review customer research",
      scheduled: addDays(today, -7),
      due: addDays(today, -1),
      projects: ["[[Product planning]]"],
      blockedBy: [{ uid: "brief", reltype: "FINISHTOSTART" }],
    },
    {
      id: "prototype",
      title: "Build interaction prototype",
      scheduled: addDays(today, 1),
      due: addDays(today, 9),
      projects: ["[[Product planning]]"],
      blockedBy: [{ uid: "research", reltype: "FINISHTOSTART" }],
      priority: "high",
    },
    {
      id: "review",
      title: "Design review",
      due: addDays(today, 10),
      projects: ["[[Product planning]]"],
      blockedBy: [{ uid: "prototype", reltype: "FINISHTOSTART" }],
    },
    {
      id: "copy",
      title: "Draft release notes",
      scheduled: addDays(today, 5),
      due: addDays(today, 12),
      projects: ["[[Launch]]"],
    },
    {
      id: "qa",
      title: "Cross-platform acceptance pass",
      scheduled: addDays(today, 11),
      due: addDays(today, 18),
      projects: ["[[Launch]]"],
      blockedBy: [
        { uid: "prototype", reltype: "FINISHTOSTART" },
        { uid: "copy", reltype: "STARTTOSTART" },
      ],
    },
    {
      id: "ship",
      title: "Release candidate",
      due: addDays(today, 20),
      projects: ["[[Launch]]"],
      blockedBy: [{ uid: "qa", reltype: "FINISHTOSTART" }],
      priority: "high",
    },
    {
      id: "metrics",
      title: "Define launch measures",
      projects: ["[[Launch]]"],
    },
    {
      id: "vendor",
      title: "Confirm accessibility audit",
      scheduled: addDays(today, 3),
      due: addDays(today, 6),
      projects: ["[[Operations]]"],
    },
  ];
  return values.map((value) => ({
    path: `tasks/${value.id}.md`,
    status: value.completed ? "done" : "open",
    priority: "normal",
    projects: [],
    blockedBy: [],
    completed: false,
    ...value,
  }));
}
