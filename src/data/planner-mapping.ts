import type { PlainValue } from "@mdbase-dev/sdk";
import { normalizeDependencyList } from "@tasknotes/model/mapping";
import type { StatusConfig } from "@tasknotes/model";

import type {
  PlannerPriorityOption,
  PlannerStatusOption,
  PlannerTask,
  SavePlannerViewInput,
} from "../domain/task";

const PLANNER_VIEW_TYPE = "tasknotesPlanner";

export interface TaskTypeConfiguration {
  typeName: string;
  fields: Record<string, string>;
  statuses: PlannerStatusOption[];
  priorities: PlannerPriorityOption[];
  defaultStatus: string;
  defaultPriority: string;
  archiveTag?: string;
}

export interface PlannerRecord {
  path: string;
  types: readonly string[];
  frontmatter: Record<string, PlainValue>;
}

/** Shared portable task mapping; native SDK callers supply unprojected fields. */
export function plannerTaskFromRecord(
  record: PlannerRecord,
  configurations: ReadonlyMap<string, TaskTypeConfiguration>,
): PlannerTask {
  const providerType = record.types.find((type) => configurations.has(type));
  const configuration = providerType
    ? configurations.get(providerType)
    : undefined;
  if (!configuration)
    throw new Error(`No TaskNotes binding was found for ${record.path}.`);
  const values = canonicalValues(record.frontmatter, configuration.fields);
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

export function taskTypeConfigurations(descriptor: {
  implementations: readonly {
    typeName: string;
    fields: Record<string, string>;
    binding?: unknown;
  }[];
}): Map<string, TaskTypeConfiguration> {
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

export function plannerViewDefinition(
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

export function aggregateStatuses(
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

export function aggregatePriorities(
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

export function modelStatuses(
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
  raw: Record<string, PlainValue>,
  fields: Record<string, string>,
): Record<string, PlainValue> {
  return Object.fromEntries(
    Object.entries(fields).flatMap(([role, field]) =>
      raw[field] === undefined ? [] : [[role, raw[field]]],
    ),
  );
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
