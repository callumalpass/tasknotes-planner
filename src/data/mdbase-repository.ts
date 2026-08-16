import {
  type CollectionContractDescriptor,
  type JsonObject,
  type MdbaseConnection,
  type QueryRecord,
  type RecordDocument,
} from "@mdbase-dev/connect";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import {
  normalizeDependencyList,
  serializeDependencies,
} from "@tasknotes/model/mapping";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model/types";

import { requireOutcome } from "./outcome";

import type {
  PlannerCollection,
  PlannerRepository,
  PlannerTask,
  ScheduleUpdate,
  TaskDependency,
} from "../domain/task";

const contract = {
  id: "tasknotes.task",
  version: TASKNOTES_SPEC_VERSION,
} as const;

export class MdbasePlannerRepository implements PlannerRepository {
  private changeCursor = 0;
  private collection: PlannerCollection | null = null;
  private completedStatuses = new Map<string, Set<string>>();

  constructor(private readonly connection: MdbaseConnection<JsonObject>) {}

  async load(): Promise<PlannerCollection> {
    const description = requireOutcome(await this.connection.describe());
    const descriptor = requireTaskNotesContract(description.contracts);
    this.completedStatuses = completedStatusesByType(descriptor);
    this.changeCursor = description.changeCursor;
    const result = requireOutcome(
      await this.connection.queryAll(
        {
          contract,
          frontmatterMode: "effective",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        { firstPageSize: 500, pageSize: 1_000 },
      ),
    );
    const tasks = result.results.flatMap((record) => {
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

  private async updateTask(
    task: PlannerTask,
    patch: JsonObject,
  ): Promise<PlannerTask> {
    const selector = {
      ...contract,
      ...(task.providerType ? { type: task.providerType } : {}),
    };
    const current = requireOutcome(
      await this.connection.read({ path: task.path, contract: selector }),
    );
    const result = requireOutcome(
      await this.connection.update({
        path: task.path,
        contract: selector,
        ifRevision: current.revision,
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

  private taskFromRecord(
    record: QueryRecord<JsonObject> | RecordDocument<JsonObject>,
  ): PlannerTask {
    const values = record.effectiveFrontmatter ?? record.frontmatter ?? {};
    const title = stringValue(values.title) ?? basename(record.path);
    const status = stringValue(values.status) ?? "open";
    const providerType = record.contract?.type;
    return {
      id: stringValue(values.id) ?? record.path,
      path: record.path,
      title,
      status,
      priority: stringValue(values.priority) ?? "normal",
      scheduled: stringValue(values.scheduled),
      due: stringValue(values.due),
      projects: stringList(values.projects),
      blockedBy: normalizeDependencyList(values.blockedBy) ?? [],
      completed: providerType
        ? (this.completedStatuses.get(providerType)?.has(status) ?? false)
        : false,
      recurrence: stringValue(values.recurrence),
      providerType,
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

function completedStatusesByType(
  descriptor: CollectionContractDescriptor,
): Map<string, Set<string>> {
  return new Map(
    descriptor.implementations.map((implementation) => {
      const binding = recordValue(implementation.binding);
      const status = recordValue(binding.status);
      return [
        implementation.typeName,
        new Set(stringList(status.completed_values)),
      ];
    }),
  );
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

function basename(path: string): string {
  return path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path;
}
