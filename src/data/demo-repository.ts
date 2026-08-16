import { addDays, dateFromDate } from "../domain/gantt";

import type {
  PlannerCollection,
  PlannerRepository,
  PlannerTask,
  PlannerView,
  SavePlannerViewInput,
  ScheduleUpdate,
  TaskDependency,
  TaskPropertyUpdate,
} from "../domain/task";

const demoStatuses = [
  {
    value: "open",
    label: "Open",
    color: "#64748b",
    order: 1,
    isCompleted: false,
    isSkipped: false,
  },
  {
    value: "in-progress",
    label: "In progress",
    color: "#3b82f6",
    order: 2,
    isCompleted: false,
    isSkipped: false,
  },
  {
    value: "done",
    label: "Done",
    color: "#22c55e",
    order: 3,
    isCompleted: true,
    isSkipped: false,
  },
  {
    value: "cancelled",
    label: "Cancelled",
    color: "#94a3b8",
    order: 4,
    isCompleted: false,
    isSkipped: true,
  },
];

const demoPriorities = [
  { value: "high", label: "High", color: "#ef4444", weight: 3 },
  { value: "normal", label: "Normal", color: "#f59e0b", weight: 2 },
  { value: "low", label: "Low", color: "#3b82f6", weight: 1 },
  { value: "none", label: "None", color: "#94a3b8", weight: 0 },
];

export class DemoPlannerRepository implements PlannerRepository {
  private readonly collection: PlannerCollection;

  constructor(today = dateFromDate(new Date())) {
    this.collection = {
      id: "demo-planning",
      name: "Product planning",
      tasks: demoTasks(today),
      views: [],
      statuses: demoStatuses,
      priorities: demoPriorities,
    };
  }

  async load(viewKey?: string): Promise<PlannerCollection> {
    const activeView = this.collection.views.find(
      (view) => view.key === viewKey,
    );
    if (activeView) this.collection.activeView = activeView;
    else delete this.collection.activeView;
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

  async updateDependencies(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ): Promise<PlannerTask> {
    const saved = { ...task, blockedBy: [...dependencies] };
    const index = this.collection.tasks.findIndex(
      (candidate) => candidate.id === task.id,
    );
    if (index >= 0) this.collection.tasks[index] = saved;
    return structuredClone(saved);
  }

  async updateProperties(
    task: PlannerTask,
    update: TaskPropertyUpdate,
  ): Promise<PlannerTask> {
    const saved = decorateTask({ ...task, ...update });
    const index = this.collection.tasks.findIndex(
      (candidate) => candidate.id === task.id,
    );
    if (index >= 0) this.collection.tasks[index] = saved;
    return structuredClone(saved);
  }

  async toggleCompletion(task: PlannerTask): Promise<PlannerTask> {
    if (task.recurrence)
      throw new Error(
        "Complete recurring tasks in TaskNotes, where you can choose an occurrence.",
      );
    return this.updateProperties(task, {
      status: task.completed ? "open" : "done",
    });
  }

  async saveView(input: SavePlannerViewInput): Promise<PlannerView> {
    const existing = input.view;
    const id = slug(input.name);
    const view: PlannerView = {
      key: existing?.key ?? `TaskNotes/Views/${id}.base#${id}`,
      path: existing?.path ?? `TaskNotes/Views/${id}.base`,
      id: existing?.id ?? id,
      name: input.name,
      format: "obsidian.base",
      revision: String(Number(existing?.revision ?? "0") + 1),
      writable: true,
      options: {
        zoom: input.zoom,
        project: input.project,
        status: input.status,
        priority: input.priority,
        showCompleted: input.showCompleted,
      },
    };
    this.collection.views = existing
      ? this.collection.views.map((candidate) =>
          candidate.key === existing.key ? view : candidate,
        )
      : [...this.collection.views, view];
    this.collection.activeView = view;
    return structuredClone(view);
  }
}

function demoTasks(today: string): PlannerTask[] {
  const values: Array<
    Pick<PlannerTask, "id" | "title"> & Partial<PlannerTask>
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
      id: "walkthrough",
      title: "Stakeholder walkthrough",
      scheduled: atTime(addDays(today, 2), "13:00"),
      due: atTime(addDays(today, 2), "14:30"),
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
      scheduled: atTime(addDays(today, 3), "09:00"),
      due: atTime(addDays(today, 3), "12:30"),
      projects: ["[[Operations]]"],
    },
  ];
  return values.map((value) =>
    decorateTask({
      path: `tasks/${value.id}.md`,
      status: value.completed ? "done" : "open",
      priority: "normal",
      projects: [],
      blockedBy: [],
      completed: false,
      ...value,
    }),
  );
}

type DecoratableTask = Pick<
  PlannerTask,
  | "id"
  | "path"
  | "title"
  | "status"
  | "priority"
  | "projects"
  | "blockedBy"
  | "completed"
> &
  Partial<PlannerTask>;

function decorateTask(task: DecoratableTask): PlannerTask {
  const status = demoStatuses.find(({ value }) => value === task.status)!;
  const priority = demoPriorities.find(({ value }) => value === task.priority)!;
  return {
    ...task,
    completed: status.isCompleted,
    statusLabel: status.label,
    statusColor: status.color,
    priorityLabel: priority.label,
    priorityColor: priority.color,
    statusOptions: demoStatuses,
    priorityOptions: demoPriorities,
  };
}

function slug(value: string): string {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "planner"
  );
}

function atTime(date: string, time: string): string {
  return `${date}T${time}:00`;
}
