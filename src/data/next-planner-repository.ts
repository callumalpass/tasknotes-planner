import {
  MdbaseError,
  toPlain,
  type MdbaseClient,
  type PlainValue,
  type wire,
} from "@mdbase-dev/sdk";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import {
  TASKNOTES_SPEC_VERSION,
  DEFAULT_FIELD_MAPPING,
  getDefaultCompletedStatus,
} from "@tasknotes/model";
import { serializeDependencies } from "@tasknotes/model/mapping";
import {
  buildTaskUpdatePlan,
  specFrontmatterToTaskInfo,
  taskInfoToSpecFields,
} from "@tasknotes/model/operations";
import { stringify } from "yaml";
import type { JsonObject } from "@mdbase-dev/connect";
import type {
  PlannerCollection,
  PlannerRepository,
  PlannerTask,
  PlannerView,
  RejectedPlannerWrite,
  ScheduleUpdate,
  TaskDependency,
  TaskPropertyUpdate,
  SavePlannerViewInput,
} from "../domain/task";
import {
  aggregatePriorities,
  aggregateStatuses,
  modelStatuses,
  plannerTaskFromRecord,
  plannerViewDefinition,
  taskTypeConfigurations,
  type TaskTypeConfiguration,
} from "./mdbase-repository";
import {
  NextPlannerViews,
  type NextPlannerViewAccess,
} from "./next-planner-views";

/** Direct new-SDK repository. No inferred task types, contract RPC compatibility
 * facade, optimistic-success reporting, or unscoped record writes. */
export class NextPlannerRepository implements PlannerRepository {
  private readonly scope = new AbortController();
  private configurations = new Map<string, TaskTypeConfiguration>();
  private readonly listeners = new Set<() => void>();
  private changesWatch: ReturnType<MdbaseClient["watchChanges"]> | undefined;
  private stopLedger: (() => void) | undefined;
  private generation = 0;
  private configurationGeneration = -1;
  private savingView = false;
  private readonly views: NextPlannerViewAccess;

  constructor(
    private readonly client: MdbaseClient,
    private readonly displayName: string,
    views?: NextPlannerViewAccess,
  ) {
    this.views = views ?? new NextPlannerViews(client);
  }

  async load(viewKey?: string): Promise<PlannerCollection> {
    const signal = this.signal();
    await this.observe(signal);
    const generation = this.generation;
    const description = await this.client.describe(signal);
    signal.throwIfAborted();
    const configurations = configurationsFromDescription(description);
    const views = await this.views.list(signal);
    signal.throwIfAborted();
    const activeView = views.find((view) => view.key === viewKey);
    if (viewKey && !activeView)
      throw new Error(
        "This saved Planner view is no longer available. Choose another view.",
      );
    const records: wire.RecordView[] = [];
    if (activeView)
      records.push(...(await this.views.execute(activeView, signal)));
    else
      for await (const page of this.client.pages(
        { types: [...configurations.keys()], limit: 1000 },
        { effective: true },
        signal,
      )) {
        signal.throwIfAborted();
        if (!page.complete)
          throw new Error(
            "The replica has not supplied a complete task index.",
          );
        records.push(...page.records);
      }
    if (generation !== this.generation) throw changed();
    const tasks = records
      .filter((record) => record.types.some((type) => configurations.has(type)))
      .map((record) => task(record, configurations));
    const identities = new Set<string>();
    for (const item of tasks) {
      if (identities.has(item.id))
        throw new Error(
          "Two task records have the same portable identity. Resolve the duplicate before planning.",
        );
      identities.add(item.id);
    }
    this.configurations = configurations;
    this.configurationGeneration = generation;
    return {
      id: this.client.hello.collection,
      name: this.displayName,
      tasks,
      views,
      ...(activeView ? { activeView } : {}),
      statuses: aggregateStatuses(configurations.values()),
      priorities: aggregatePriorities(configurations.values()),
    };
  }

  updateSchedule(
    item: PlannerTask,
    update: ScheduleUpdate,
  ): Promise<PlannerTask> {
    return this.update(item, () => ({
      scheduled: update.scheduled ?? null,
      due: update.due ?? null,
    }));
  }

  updateDependencies(
    item: PlannerTask,
    dependencies: readonly TaskDependency[],
  ): Promise<PlannerTask> {
    return this.update(item, () => ({
      blockedBy: serializeDependencies(dependencies),
    }));
  }

  updateProperties(
    item: PlannerTask,
    update: TaskPropertyUpdate,
  ): Promise<PlannerTask> {
    return this.update(item, (record, config) => {
      if (
        update.status !== undefined &&
        !config.statuses.some((option) => option.value === update.status)
      )
        throw new Error("This status is not available for this task type.");
      if (
        update.priority !== undefined &&
        !config.priorities.some((option) => option.value === update.priority)
      )
        throw new Error("This priority is not available for this task type.");
      const values = canonical(record, config);
      const plan = buildTaskUpdatePlan({
        originalTask: specFrontmatterToTaskInfo(values, record.path),
        updates: update,
        fieldMapping: DEFAULT_FIELD_MAPPING,
        statuses: modelStatuses(config.statuses),
        now: new Date().toISOString(),
      });
      const next = taskInfoToSpecFields(plan.updatedTask);
      return Object.fromEntries(
        ["status", "priority", "projects", "completedDate"].flatMap((field) =>
          JSON.stringify(values[field]) === JSON.stringify(next[field])
            ? []
            : [[field, next[field] ?? null]],
        ),
      ) as JsonObject;
    });
  }

  async toggleCompletion(item: PlannerTask): Promise<PlannerTask> {
    if (item.recurrence)
      throw new Error(
        "Complete recurring tasks in TaskNotes, where you can choose an occurrence.",
      );
    await this.revalidateConfigurations(this.signal());
    const config = this.configuration(item);
    const completedStatus = getDefaultCompletedStatus(
      modelStatuses(config.statuses),
    );
    if (!config.statuses.some((option) => option.value === completedStatus))
      throw new Error(
        "This task type does not define a completed TaskNotes status.",
      );
    return this.updateProperties(item, {
      status: item.completed ? config.defaultStatus : completedStatus,
    });
  }

  async saveView(input: SavePlannerViewInput): Promise<PlannerView> {
    const name = input.name.trim();
    if (!name) throw new Error("Give this view a name before saving it.");
    if (this.savingView)
      throw new Error("Wait for the view save before saving another view.");
    if (this.configurationGeneration !== this.generation) throw changed();
    this.savingView = true;
    try {
      return await this.views.save(
        { ...input, name },
        stringify(
          plannerViewDefinition(name, input, this.configurations.values()),
          { lineWidth: 0 },
        ),
        this.signal(),
      );
    } finally {
      this.savingView = false;
    }
  }

  /** Writes the collection refused after they were saved on this device. */
  rejectedWrites(): readonly RejectedPlannerWrite[] {
    return this.client.ledger.getSnapshot().rejected.map((entry) => ({
      id: entry.mutationId,
      message: entry.problem?.message ?? "The collection refused the change.",
    }));
  }

  savedOnDevice(): boolean {
    return this.client.ledger.getSnapshot().saveState === "saved_on_device";
  }

  onSaveState(listener: () => void): () => void {
    return this.client.ledger.subscribe(listener);
  }

  async dismissRejectedWrite(id: string): Promise<void> {
    await this.client.ledger.acknowledge(id);
    this.emit();
  }

  async watch(listener: () => void): Promise<() => void> {
    this.listeners.add(listener);
    try {
      await this.observe(this.signal());
    } catch (reason) {
      this.listeners.delete(listener);
      throw reason;
    }
    return () => this.listeners.delete(listener);
  }

  /** Close repository work only. The shared sign-in session owns the SDK client. */
  dispose(): void {
    this.scope.abort();
    this.changesWatch?.();
    this.stopLedger?.();
    this.listeners.clear();
  }

  private configuration(item: PlannerTask): TaskTypeConfiguration {
    if (this.configurationGeneration !== this.generation)
      throw new Error("The collection changed. Reload Planner before editing.");
    const config = item.providerType
      ? this.configurations.get(item.providerType)
      : undefined;
    if (!config)
      throw new Error("Reload Planner before editing this task type.");
    return config;
  }

  /** Record notifications invalidate the snapshot, not necessarily its bindings.
   * Re-read the catalog before a second edit rather than asking users to reload
   * and discard their date drafts. Actual binding changes still require reload. */
  private async revalidateConfigurations(signal: AbortSignal): Promise<void> {
    await this.observe(signal);
    if (this.configurationGeneration === this.generation) return;
    const generation = this.generation;
    const previous = this.configurations;
    const description = await this.client.describe(signal);
    signal.throwIfAborted();
    const configurations = configurationsFromDescription(description);
    if (generation !== this.generation) throw changed();
    if (
      configurationSignature(previous) !==
      configurationSignature(configurations)
    )
      throw new Error("The collection changed. Reload Planner before editing.");
    this.configurationGeneration = generation;
  }

  private async update(
    item: PlannerTask,
    patch: (
      record: wire.RecordView,
      config: TaskTypeConfiguration,
    ) => JsonObject,
  ): Promise<PlannerTask> {
    const signal = this.signal();
    await this.revalidateConfigurations(signal);
    const config = this.configuration(item);
    const configurations = this.configurations;
    const generation = this.generation;
    const record = await this.client.get(
      { path: item.path },
      { effective: true },
      signal,
    );
    signal.throwIfAborted();
    if (
      !record.types.includes(config.typeName) ||
      task(record, configurations).id !== item.id
    )
      throw new Error(
        "This task changed its identity. Reload it before editing.",
      );
    if (record.state.hold || record.state.unresolved)
      throw new Error(
        "This task has a protected edit. Resolve it in TaskNotes before planning.",
      );
    if (generation !== this.generation) throw changed();
    const fields = patch(record, config);
    // Contract fields go to the replica, which maps them to this type's record
    // fields (nested fields merge). Null removes a field.
    const changes: Record<string, PlainValue> = {};
    const unset: string[] = [];
    for (const [role, value] of Object.entries(fields)) {
      if (!config.fields[role])
        throw new Error(`This TaskNotes type does not expose ${role}.`);
      if (value === null) unset.push(role);
      else changes[role] = value as PlainValue;
    }
    if (!Object.keys(fields).length) return task(record, configurations);
    // Unconfirmed writes are the SDK's: saved on this device, settled by its
    // write ledger, and listed in `rejectedWrites` if the log refuses them.
    const result = await this.client.save(
      this.client.update(
        record,
        {
          contract: {
            id: "tasknotes.task",
            version: TASKNOTES_SPEC_VERSION,
            type: config.typeName,
          },
          patch: changes,
          ...(unset.length ? { unset } : {}),
          ifRevision: record.revision,
        },
        { signal },
      ),
      { readBack: true, signal },
    );
    if (result.outcome === "rejected") {
      // Shown here, so not again as a rejected write.
      await this.client.ledger.acknowledge(result.mutationId);
      throw result.problem
        ? new MdbaseError(result.problem)
        : new Error("The task change was rejected.");
    }
    const saved = result.record;
    if (!saved)
      throw new Error("The saved task's native target is unavailable.");
    if (saved.state.hold || saved.state.unresolved)
      throw new Error(
        "This change has a conflict. Resolve it in TaskNotes before planning.",
      );
    const next = task(saved, configurations);
    if (next.id !== item.id || next.providerType !== config.typeName)
      throw new Error(
        "The saved task changed its portable identity. Refresh Planner.",
      );
    return next;
  }

  private signal(): AbortSignal {
    this.scope.signal.throwIfAborted();
    return AbortSignal.any([this.scope.signal, AbortSignal.timeout(45_000)]);
  }

  private async observe(signal: AbortSignal): Promise<void> {
    if (
      this.changesWatch &&
      ["closed", "failed"].includes(this.changesWatch.state)
    ) {
      this.changesWatch();
      this.changesWatch = undefined;
    }
    if (!this.changesWatch) {
      this.stopLedger ??= this.watchRejections();
      const watch = this.client.watchChanges(undefined, () => this.emit());
      this.changesWatch = watch;
      watch.subscribe((state) => {
        if (this.changesWatch === watch && ["stale", "failed"].includes(state))
          this.emit();
      });
    }
    signal.throwIfAborted();
    await untilReady(this.changesWatch.ready, signal);
    signal.throwIfAborted();
    if (this.changesWatch.state !== "active")
      throw this.changesWatch.error ?? changed();
  }

  /** A write refused after it was saved on this device: reload and show it. */
  private watchRejections(): () => void {
    let rejected = this.client.ledger.getSnapshot().rejected;
    return this.client.ledger.subscribe(() => {
      const next = this.client.ledger.getSnapshot().rejected;
      if (next === rejected) return;
      const changed =
        next.length !== rejected.length ||
        next.some(
          (entry, index) => entry.mutationId !== rejected[index]?.mutationId,
        );
      rejected = next;
      if (changed) this.emit();
    });
  }

  private emit(): void {
    this.generation++;
    for (const listener of this.listeners) listener();
  }
}

function configurationsFromDescription(
  description: wire.DescribeResult,
): Map<string, TaskTypeConfiguration> {
  const contract = description.contracts.find(
    (item) =>
      item.id === "tasknotes.task" &&
      item.version === TASKNOTES_SPEC_VERSION &&
      item.digest === TASKNOTES_CONTRACT_DIGEST,
  );
  if (!contract)
    throw new Error(
      `This collection does not provide tasknotes.task ${TASKNOTES_SPEC_VERSION}.`,
    );
  const implementations = description.types.flatMap((type) => {
    const matches = type.implements.filter(
      (item) =>
        item.contract === contract.id && item.version === contract.version,
    );
    if (matches.length > 1)
      throw new Error(
        `The type ${type.name} has ambiguous TaskNotes implementations.`,
      );
    return matches.map((implementation) => ({
      typeName: type.name,
      fields: Object.fromEntries(implementation.fields),
      binding:
        implementation.binding === undefined
          ? {}
          : toPlain(implementation.binding),
    }));
  });
  if (!implementations.length)
    throw new Error("The TaskNotes contract has no implementing types.");
  // Native update.patch is top-level; do not silently write a dotted literal
  // where the contract actually declares a nested field reference.
  for (const implementation of implementations)
    if (
      Object.values(implementation.fields).some(
        (field) => field.includes(".") || field.includes("["),
      )
    )
      throw new Error(
        "This TaskNotes binding needs nested-field support in the shared SDK.",
      );
  return taskTypeConfigurations({ implementations });
}

function configurationSignature(
  configurations: ReadonlyMap<string, TaskTypeConfiguration>,
): string {
  return JSON.stringify(
    [...configurations]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, config]) => [
        name,
        {
          ...config,
          fields: Object.fromEntries(
            Object.entries(config.fields).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          ),
        },
      ]),
  );
}

function canonical(
  record: wire.RecordView,
  config: TaskTypeConfiguration,
): JsonObject {
  const raw = Object.fromEntries(
    [...(record.effective ?? record.frontmatter)].map(([key, value]) => [
      key,
      toPlain(value),
    ]),
  );
  return Object.fromEntries(
    Object.entries(config.fields).flatMap(([role, field]) =>
      raw[field] === undefined ? [] : [[role, raw[field]]],
    ),
  ) as JsonObject;
}

function task(
  record: wire.RecordView,
  configurations: ReadonlyMap<string, TaskTypeConfiguration>,
): PlannerTask {
  return plannerTaskFromRecord(
    {
      path: record.path,
      types: record.types,
      frontmatter: Object.fromEntries(
        [...(record.effective ?? record.frontmatter)].map(([key, value]) => [
          key,
          toPlain(value),
        ]),
      ) as JsonObject,
    },
    configurations,
  );
}

async function untilReady(
  ready: Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    await Promise.race([ready, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function changed(): MdbaseError {
  return new MdbaseError({
    code: "conflict",
    recovery: "refresh",
    reason: "collection_changed",
    message: "The collection changed while loading. Refresh Planner.",
  });
}
