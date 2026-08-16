import {
  type CollectionContractDescriptor,
  type JsonObject,
  type MdbaseConnection,
  type QueryRecord,
  type RecordDocument,
  type SavedNamedView,
  type SavedViewDocument,
  type SavedViewExecution,
} from "@mdbase-dev/connect";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import {
  normalizeDependencyList,
  serializeDependencies,
} from "@tasknotes/model/mapping";
import {
  buildTaskUpdatePlan,
  specFrontmatterToTaskInfo,
  taskInfoToSpecFields,
} from "@tasknotes/model/operations";
import {
  DEFAULT_FIELD_MAPPING,
  TASKNOTES_SPEC_VERSION,
  type StatusConfig,
} from "@tasknotes/model";
import { parse, stringify } from "yaml";

import { requireOutcome } from "./outcome";

import type {
  PlannerCollection,
  PlannerPriorityOption,
  PlannerRepository,
  PlannerStatusOption,
  PlannerTask,
  PlannerView,
  PlannerViewOptions,
  SavePlannerViewInput,
  ScheduleUpdate,
  TaskDependency,
  TaskPropertyUpdate,
} from "../domain/task";

const contract = {
  id: "tasknotes.task",
  version: TASKNOTES_SPEC_VERSION,
} as const;

const PLANNER_VIEW_TYPE = "tasknotesPlanner";
const PLANNER_VIEW_FOLDER = "TaskNotes/Views";

interface TaskTypeConfiguration {
  typeName: string;
  fields: Record<string, string>;
  statuses: PlannerStatusOption[];
  priorities: PlannerPriorityOption[];
  defaultStatus: string;
  defaultPriority: string;
  archiveTag?: string;
}

export class MdbasePlannerRepository implements PlannerRepository {
  private changeCursor = 0;
  private collection: PlannerCollection | null = null;
  private taskTypes = new Map<string, TaskTypeConfiguration>();

  constructor(private readonly connection: MdbaseConnection<JsonObject>) {}

  async load(viewKey?: string): Promise<PlannerCollection> {
    const [description, viewList] = await Promise.all([
      this.connection.describe().then(requireOutcome),
      this.connection.listViews().then(requireOutcome),
    ]);
    const descriptor = requireTaskNotesContract(description.contracts);
    this.taskTypes = taskTypeConfigurations(descriptor);
    this.changeCursor = description.changeCursor;
    const views = plannerViews(viewList.views);
    const activeView = views.find((view) => view.key === viewKey);
    const records = activeView
      ? requireOutcome(
          await this.connection.executeView({
            path: activeView.path,
            view: activeView.id,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            limit: 2_000,
            render: false,
          }),
        ).results
      : requireOutcome(
          await this.connection.queryAll(
            {
              contract,
              frontmatterMode: "effective",
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
            { firstPageSize: 500, pageSize: 1_000 },
          ),
        ).results;
    const tasks = records.flatMap((record) => {
      try {
        return [this.taskFromRecord(record)];
      } catch {
        return [];
      }
    });
    this.collection = {
      id: description.collectionId,
      name: description.displayName,
      tasks,
      views,
      ...(activeView ? { activeView } : {}),
      statuses: aggregateStatuses(this.taskTypes.values()),
      priorities: aggregatePriorities(this.taskTypes.values()),
    };
    return structuredClone(this.collection);
  }

  async updateSchedule(
    task: PlannerTask,
    update: ScheduleUpdate,
  ): Promise<PlannerTask> {
    return this.updateTask(task, {
      scheduled: update.scheduled ?? null,
      due: update.due ?? null,
    });
  }

  async updateDependencies(
    task: PlannerTask,
    dependencies: readonly TaskDependency[],
  ): Promise<PlannerTask> {
    return this.updateTask(task, {
      blockedBy: serializeDependencies(dependencies),
    });
  }

  async updateProperties(
    task: PlannerTask,
    update: TaskPropertyUpdate,
  ): Promise<PlannerTask> {
    const selector = this.selector(task);
    const current = requireOutcome(
      await this.connection.read({ path: task.path, contract: selector }),
    );
    const config = task.providerType
      ? this.taskTypes.get(task.providerType)
      : undefined;
    if (!config)
      throw new Error("This task type does not expose TaskNotes settings.");
    if (
      update.status !== undefined &&
      !config.statuses.some(({ value }) => value === update.status)
    )
      throw new Error("This status is not available for this task type.");
    if (
      update.priority !== undefined &&
      !config.priorities.some(({ value }) => value === update.priority)
    )
      throw new Error("This priority is not available for this task type.");

    const values = current.effectiveFrontmatter;
    const original = specFrontmatterToTaskInfo(values, task.path);
    const plan = buildTaskUpdatePlan({
      originalTask: original,
      updates: {
        ...(update.status === undefined ? {} : { status: update.status }),
        ...(update.priority === undefined ? {} : { priority: update.priority }),
      },
      fieldMapping: DEFAULT_FIELD_MAPPING,
      statuses: modelStatuses(config.statuses),
      now: new Date().toISOString(),
    });
    const next = taskInfoToSpecFields(plan.updatedTask);
    const patch: JsonObject = {};
    for (const field of ["status", "priority", "completedDate"] as const) {
      if (values[field] === next[field]) continue;
      patch[field] = (next[field] ?? null) as JsonObject[string];
    }
    return this.persistTask(task, current.revision, selector, patch);
  }

  async saveView(input: SavePlannerViewInput): Promise<PlannerView> {
    const name = input.name.trim();
    if (!name) throw new Error("Give this view a name before saving it.");
    const document = plannerViewDefinition(
      name,
      input,
      this.taskTypes.values(),
    );
    if (input.view) {
      if (input.view.format !== "obsidian.base" || !input.view.writable)
        throw new Error("This Planner view cannot be changed here.");
      const source = requireOutcome(
        await this.connection.readViewSource({ path: input.view.path }),
      );
      const value = recordValue(parse(source.document));
      const views = objectList(value.views);
      const index = stableIds(
        views.map((view) => stringValue(view.name) ?? ""),
      ).indexOf(input.view.id);
      if (index < 0)
        throw new Error("This view is no longer in its Base file.");
      const previous = views[index];
      views[index] = {
        ...previous,
        ...document.views[0],
        options: {
          ...recordValue(previous.options),
          ...recordValue(document.views[0].options),
        },
      };
      value.views = views;
      const saved = requireOutcome(
        await this.connection.updateViewSource({
          path: source.path,
          ifRevision: source.revision,
          document: stringify(value, { lineWidth: 0 }),
        }),
      );
      return viewFromDefinition(
        saved.path,
        saved.format,
        saved.revision,
        true,
        document.views[0],
      );
    }

    const saved = requireOutcome(
      await this.connection.createViewSource({
        path: plannerViewSourcePath(name),
        format: "obsidian.base",
        name,
        document: stringify(document, { lineWidth: 0 }),
      }),
    );
    return viewFromDefinition(
      saved.path,
      saved.format,
      saved.revision,
      true,
      document.views[0],
    );
  }

  private async updateTask(
    task: PlannerTask,
    patch: JsonObject,
  ): Promise<PlannerTask> {
    const selector = this.selector(task);
    const current = requireOutcome(
      await this.connection.read({ path: task.path, contract: selector }),
    );
    return this.persistTask(task, current.revision, selector, patch);
  }

  private async persistTask(
    task: PlannerTask,
    revision: string,
    selector: typeof contract & { type?: string },
    patch: JsonObject,
  ): Promise<PlannerTask> {
    const result = requireOutcome(
      await this.connection.update({
        path: task.path,
        contract: selector,
        ifRevision: revision,
        patch,
      }),
    );
    const saved = this.taskFromRecord(result);
    if (this.collection)
      this.collection.tasks = this.collection.tasks.map((candidate) =>
        candidate.id === saved.id ? saved : candidate,
      );
    return structuredClone(saved);
  }

  async watch(listener: () => void): Promise<() => void> {
    const subscription = requireOutcome(
      await this.connection.watch({ cursor: this.changeCursor }),
    );
    const unsubscribe = subscription.subscribe(() => listener());
    return () => {
      unsubscribe();
      subscription.close();
    };
  }

  private selector(task: PlannerTask) {
    return {
      ...contract,
      ...(task.providerType ? { type: task.providerType } : {}),
    };
  }

  private taskFromRecord(
    record:
      | QueryRecord<JsonObject>
      | RecordDocument<JsonObject>
      | SavedViewExecution<JsonObject>["results"][number],
  ): PlannerTask {
    const raw = record.effectiveFrontmatter ?? record.frontmatter ?? {};
    const providerType =
      record.contract?.type ??
      record.types.find((type) => this.taskTypes.has(type));
    const configuration = providerType
      ? this.taskTypes.get(providerType)
      : undefined;
    if (!configuration)
      throw new Error(`No TaskNotes binding was found for ${record.path}.`);
    const values = record.contract
      ? raw
      : canonicalValues(raw, configuration.fields);
    const title = stringValue(values.title) ?? basename(record.path);
    const status = stringValue(values.status) ?? configuration.defaultStatus;
    const priority =
      stringValue(values.priority) ?? configuration.defaultPriority;
    const statusDefinition = configuration.statuses.find(
      ({ value }) => value === status,
    );
    const priorityDefinition = configuration.priorities.find(
      ({ value }) => value === priority,
    );
    return {
      id: stringValue(values.id) ?? record.path,
      path: record.path,
      title,
      status,
      priority,
      scheduled: stringValue(values.scheduled),
      due: stringValue(values.due),
      projects: stringList(values.projects),
      blockedBy: normalizeDependencyList(values.blockedBy) ?? [],
      completed: statusDefinition?.isCompleted ?? false,
      recurrence: stringValue(values.recurrence),
      providerType,
      statusLabel: statusDefinition?.label ?? status,
      statusColor: statusDefinition?.color ?? "#64748b",
      priorityLabel: priorityDefinition?.label ?? priority,
      priorityColor: priorityDefinition?.color ?? "#64748b",
      statusOptions: configuration.statuses,
      priorityOptions: configuration.priorities,
    };
  }
}

function requireTaskNotesContract(
  contracts: readonly CollectionContractDescriptor[],
): CollectionContractDescriptor {
  const descriptor = contracts.find(
    (candidate) =>
      candidate.id === contract.id &&
      candidate.version === contract.version &&
      candidate.digest === TASKNOTES_CONTRACT_DIGEST,
  );
  if (!descriptor)
    throw new Error(
      `This collection does not provide tasknotes.task ${TASKNOTES_SPEC_VERSION}.`,
    );
  return descriptor;
}

function taskTypeConfigurations(
  descriptor: CollectionContractDescriptor,
): Map<string, TaskTypeConfiguration> {
  return new Map(
    descriptor.implementations.map((implementation) => {
      const binding = recordValue(implementation.binding);
      const status = recordValue(binding.status);
      const priority = recordValue(binding.priority);
      const archive = recordValue(binding.archive);
      const statuses = objectList(status.definitions).map(
        (definition, index) => ({
          value: stringValue(definition.value) ?? `status-${index + 1}`,
          label:
            stringValue(definition.label) ??
            humanize(stringValue(definition.value) ?? `Status ${index + 1}`),
          color: stringValue(definition.color) ?? "#64748b",
          ...(stringValue(definition.icon)
            ? { icon: stringValue(definition.icon) }
            : {}),
          order: numberValue(definition.order) ?? index,
          isCompleted: booleanValue(definition.is_completed),
          isSkipped: booleanValue(definition.is_skipped),
        }),
      );
      const priorities = objectList(priority.definitions).map(
        (definition, index) => ({
          value: stringValue(definition.value) ?? `priority-${index + 1}`,
          label:
            stringValue(definition.label) ??
            humanize(stringValue(definition.value) ?? `Priority ${index + 1}`),
          color: stringValue(definition.color) ?? "#64748b",
          ...(stringValue(definition.icon)
            ? { icon: stringValue(definition.icon) }
            : {}),
          weight: numberValue(definition.weight) ?? index,
        }),
      );
      const configuration: TaskTypeConfiguration = {
        typeName: implementation.typeName,
        fields: { ...implementation.fields },
        statuses,
        priorities,
        defaultStatus:
          stringValue(status.default) ?? statuses[0]?.value ?? "none",
        defaultPriority:
          stringValue(priority.default) ?? priorities[0]?.value ?? "none",
        ...(stringValue(archive.archived_tag)
          ? { archiveTag: stringValue(archive.archived_tag) }
          : {}),
      };
      return [implementation.typeName, configuration];
    }),
  );
}

function plannerViews(documents: readonly SavedViewDocument[]): PlannerView[] {
  return documents.flatMap((document) =>
    document.views.flatMap((view) =>
      isPlannerPresentation(view)
        ? [
            {
              key: `${document.source.path}#${view.id}`,
              path: document.source.path,
              id: view.id,
              name: view.name,
              format: document.source.format,
              revision: document.source.revision,
              writable:
                document.source.writable &&
                document.source.format === "obsidian.base",
              options: plannerOptions(view.presentation?.options),
            },
          ]
        : [],
    ),
  );
}

function isPlannerPresentation(view: SavedNamedView): boolean {
  return (
    view.presentation?.type === PLANNER_VIEW_TYPE ||
    view.presentation?.type === "tasknotes.planner"
  );
}

function plannerOptions(value: unknown): PlannerViewOptions {
  const options = recordValue(value);
  return {
    ...(numberValue(options.zoom) === undefined
      ? {}
      : { zoom: numberValue(options.zoom) }),
    ...(stringValue(options.project)
      ? { project: stringValue(options.project) }
      : {}),
    ...(stringValue(options.status)
      ? { status: stringValue(options.status) }
      : {}),
    ...(stringValue(options.priority)
      ? { priority: stringValue(options.priority) }
      : {}),
    ...(typeof options.showCompleted === "boolean"
      ? { showCompleted: options.showCompleted }
      : {}),
  };
}

function plannerViewDefinition(
  name: string,
  input: SavePlannerViewInput,
  taskTypes: Iterable<TaskTypeConfiguration>,
) {
  const configurations = [...taskTypes];
  const primary = configurations[0];
  const filters = plannerFilters(input, configurations);
  const order = primary
    ? ["title", "scheduled", "due", "status", "priority"].flatMap((role) =>
        primary.fields[role] ? [basesProperty(primary.fields[role])] : [],
      )
    : undefined;
  const sort = primary
    ? [
        sortDefinition(primary.fields.scheduled, "ASC"),
        sortDefinition(primary.fields.due, "ASC"),
        sortDefinition(primary.fields.priority, "DESC"),
      ].filter(Boolean)
    : undefined;
  return {
    views: [
      compact({
        type: PLANNER_VIEW_TYPE,
        name,
        filters,
        order,
        sort,
        options: compact({
          zoom: input.zoom,
          project: input.project === "all" ? undefined : input.project,
          status: input.status === "all" ? undefined : input.status,
          priority: input.priority === "all" ? undefined : input.priority,
          showCompleted: input.showCompleted ?? false,
        }),
      }),
    ],
  };
}

function plannerFilters(
  input: SavePlannerViewInput,
  taskTypes: readonly TaskTypeConfiguration[],
): unknown {
  const groups = taskTypes.map((configuration) => {
    const statusField = noteProperty(configuration.fields.status);
    const conditions: string[] = [`${statusField}.isEmpty() == false`];
    if (input.status && input.status !== "all")
      conditions.push(`${statusField} == ${literal(input.status)}`);
    else if (!input.showCompleted)
      for (const status of configuration.statuses.filter(
        ({ isCompleted }) => isCompleted,
      ))
        conditions.push(`${statusField} != ${literal(status.value)}`);
    if (configuration.archiveTag)
      conditions.push(
        `file.hasTag(${literal(configuration.archiveTag)}) != true`,
      );
    if (input.priority && input.priority !== "all")
      conditions.push(
        `${noteProperty(configuration.fields.priority)} == ${literal(input.priority)}`,
      );
    if (input.project && input.project !== "all")
      conditions.push(
        `${noteProperty(configuration.fields.projects)}.contains(${literal(input.project)})`,
      );
    return conditions.length === 1 ? conditions[0] : { and: conditions };
  });
  if (!groups.length) return undefined;
  return groups.length === 1 ? groups[0] : { or: groups };
}

function viewFromDefinition(
  path: string,
  format: string,
  revision: string,
  writable: boolean,
  view: Record<string, unknown>,
): PlannerView {
  const name = stringValue(view.name) ?? "Planner";
  const id = identifier(name, "view");
  return {
    key: `${path}#${id}`,
    path,
    id,
    name,
    format,
    revision,
    writable: writable && format === "obsidian.base",
    options: plannerOptions(view.options),
  };
}

function aggregateStatuses(
  configurations: Iterable<TaskTypeConfiguration>,
): PlannerStatusOption[] {
  const values = new Map<string, PlannerStatusOption>();
  for (const configuration of configurations)
    for (const option of configuration.statuses)
      if (!values.has(option.value)) values.set(option.value, option);
  return [...values.values()].sort(
    (left, right) =>
      left.order - right.order || left.label.localeCompare(right.label),
  );
}

function aggregatePriorities(
  configurations: Iterable<TaskTypeConfiguration>,
): PlannerPriorityOption[] {
  const values = new Map<string, PlannerPriorityOption>();
  for (const configuration of configurations)
    for (const option of configuration.priorities)
      if (!values.has(option.value)) values.set(option.value, option);
  return [...values.values()].sort(
    (left, right) =>
      right.weight - left.weight || left.label.localeCompare(right.label),
  );
}

function modelStatuses(
  options: readonly PlannerStatusOption[],
): StatusConfig[] {
  return options.map((option) => ({
    id: option.value,
    value: option.value,
    label: option.label,
    color: option.color,
    ...(option.icon ? { icon: option.icon } : {}),
    isCompleted: option.isCompleted,
    isSkipped: option.isSkipped,
    order: option.order,
    autoArchive: false,
    autoArchiveDelay: 0,
  }));
}

function canonicalValues(
  raw: JsonObject,
  fields: Record<string, string>,
): JsonObject {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([role, field]) =>
      raw[field] === undefined ? [] : [[role, raw[field]]],
    ),
  ) as JsonObject;
}

function plannerViewSourcePath(name: string): string {
  return `${PLANNER_VIEW_FOLDER}/${slug(name) || "planner"}.base`;
}

function slug(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function stableIds(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const base = identifier(name, "view");
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  });
}

function identifier(value: string, fallback: string): string {
  const normalized = value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_.:]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(normalized) ? normalized : `${fallback}-${normalized}`;
}

function sortDefinition(field: string | undefined, direction: "ASC" | "DESC") {
  return field ? { property: basesProperty(field), direction } : undefined;
}

function noteProperty(field: string | undefined): string {
  return `note[${literal(field ?? "missing")}]`;
}

function basesProperty(field: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)
    ? `note.${field}`
    : noteProperty(field);
}

function literal(value: string): string {
  return JSON.stringify(value);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function objectList(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(recordValue) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : typeof value === "string"
      ? [value]
      : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function humanize(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function basename(path: string): string {
  return path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path;
}
