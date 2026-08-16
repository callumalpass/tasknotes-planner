import type {
  TaskDependency,
  TaskDependencyRelType,
} from "@tasknotes/model/types";

export type { TaskDependency, TaskDependencyRelType };

export interface PlannerTask {
  id: string;
  path: string;
  title: string;
  status: string;
  priority: string;
  scheduled?: string;
  due?: string;
  projects: string[];
  blockedBy: TaskDependency[];
  completed: boolean;
  recurrence?: string;
  providerType?: string;
}

export interface PlannerCollection {
  id: string;
  name: string;
  tasks: PlannerTask[];
}

export interface ScheduleUpdate {
  scheduled?: string;
  due?: string;
}

export interface PlannerRepository {
  load(): Promise<PlannerCollection>;
  updateSchedule(
    task: PlannerTask,
    update: ScheduleUpdate,
  ): Promise<PlannerTask>;
  updateDependencies(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ): Promise<PlannerTask>;
  watch?(listener: () => void): Promise<() => void>;
}
