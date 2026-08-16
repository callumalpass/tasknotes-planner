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
  statusLabel: string;
  statusColor: string;
  priorityLabel: string;
  priorityColor: string;
  statusOptions: PlannerStatusOption[];
  priorityOptions: PlannerPriorityOption[];
}

export interface PlannerCollection {
  id: string;
  name: string;
  tasks: PlannerTask[];
  views: PlannerView[];
  activeView?: PlannerView;
  statuses: PlannerStatusOption[];
  priorities: PlannerPriorityOption[];
}

export interface PlannerStatusOption {
  value: string;
  label: string;
  color: string;
  icon?: string;
  order: number;
  isCompleted: boolean;
  isSkipped: boolean;
}

export interface PlannerPriorityOption {
  value: string;
  label: string;
  color: string;
  icon?: string;
  weight: number;
}

export interface PlannerViewOptions {
  zoom?: number;
  project?: string;
  status?: string;
  priority?: string;
  showCompleted?: boolean;
}

export interface PlannerView {
  key: string;
  path: string;
  id: string;
  name: string;
  format: string;
  revision: string;
  writable: boolean;
  options: PlannerViewOptions;
}

export interface SavePlannerViewInput extends PlannerViewOptions {
  name: string;
  view?: PlannerView;
}

export interface ScheduleUpdate {
  scheduled?: string;
  due?: string;
}

export interface TaskPropertyUpdate {
  status?: string;
  priority?: string;
  projects?: string[];
}

export interface PlannerRepository {
  load(viewKey?: string): Promise<PlannerCollection>;
  updateSchedule(
    task: PlannerTask,
    update: ScheduleUpdate,
  ): Promise<PlannerTask>;
  updateDependencies(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ): Promise<PlannerTask>;
  updateProperties(
    task: PlannerTask,
    update: TaskPropertyUpdate,
  ): Promise<PlannerTask>;
  toggleCompletion(task: PlannerTask): Promise<PlannerTask>;
  saveView(input: SavePlannerViewInput): Promise<PlannerView>;
  watch?(listener: () => void): Promise<() => void>;
}
