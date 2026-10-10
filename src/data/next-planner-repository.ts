import {
  MdbaseError,
  toPlain,
  type MdbaseClient,
  type PlainValue,
  type wire,
  type Write,
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
  PendingPlannerMutation,
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
  private readonly pending = new Map<string, PendingPlannerMutation>();
  private readonly listeners = new Set<() => void>();
  private changesWatch: ReturnType<MdbaseClient["watchChanges"]> | undefined;
  private generation = 0;
  private configurationGeneration = -1;
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
    const configurations = taskTypeConfigurations({ implementations });
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
    const mutations = await this.client.pendingWrites(signal);
    signal.throwIfAborted();
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
    for (const mutation of mutations)
      this.pending.set(mutation.receipt.mutation, {
        requestId: mutation.receipt.mutation,
        operation: mutation.ops.map((op) => op.kind).join(", "),
        createdAt: new Date(mutation.captured).toISOString(),
      });
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
    return this.views.save(
      { ...input, name },
      stringify(
        plannerViewDefinition(name, input, this.configurations.values()),
        { lineWidth: 0 },
      ),
      this.signal(),
    );
  }

  pendingMutations(): readonly PendingPlannerMutation[] {
    return [...this.pending.values()];
  }

  async recoverPendingMutation(requestId: string): Promise<void> {
    if (!this.pending.has(requestId)) return;
    const signal = this.signal();
    await this.confirm(requestId, signal);
    signal.throwIfAborted();
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

  private async update(
    item: PlannerTask,
    patch: (
      record: wire.RecordView,
      config: TaskTypeConfiguration,
    ) => JsonObject,
  ): Promise<PlannerTask> {
    if (this.pending.size)
      throw new Error("Check the pending write before making another change.");
    const signal = this.signal();
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
    if (record.state.state === "pending")
      throw new Error(
        "This task already has a pending edit. Wait for confirmation before planning.",
      );
    if (generation !== this.generation) throw changed();
    const fields = patch(record, config);
    const mapped: Record<string, PlainValue> = {};
    for (const [role, value] of Object.entries(fields)) {
      const field = config.fields[role];
      if (!field)
        throw new Error(`This TaskNotes type does not expose ${role}.`);
      mapped[field] = value as PlainValue;
    }
    if (!Object.keys(mapped).length) return task(record, configurations);
    // Another inspector operation may have finished its read concurrently.
    if (this.pending.size)
      throw new Error("Check the pending write before making another change.");
    const mutationId = crypto.randomUUID();
    this.pending.set(mutationId, {
      requestId: mutationId,
      operation: "update",
      createdAt: new Date().toISOString(),
    });
    let write: Write;
    try {
      write = await this.client.update(
        record,
        { patch: mapped, ifRevision: record.revision },
        { mutationId, signal },
      );
    } catch (reason) {
      // A transport failure may have crossed the submission boundary. Keep the
      // same mutation for receipt recovery; never mint a retry on that basis.
      if (
        reason instanceof MdbaseError &&
        !["outcome_unknown", "unavailable", "cancelled"].includes(reason.code)
      )
        this.pending.delete(mutationId);
      throw reason;
    }
    if (write.mutationId !== mutationId)
      throw new Error("The write changed its mutation identity.");
    await this.confirm(mutationId, signal);
    const saved = await this.client.get(record.id, { effective: true }, signal);
    signal.throwIfAborted();
    const result = task(saved, configurations);
    if (result.id !== item.id || result.providerType !== config.typeName)
      throw new Error(
        "The saved task changed its portable identity. Refresh Planner.",
      );
    return result;
  }

  private async confirm(mutation: string, signal: AbortSignal): Promise<void> {
    const receipt = await this.client.awaitReceipt(mutation, 30_000, signal);
    signal.throwIfAborted();
    if (receipt.mutation !== mutation)
      throw new Error("The receipt changed its mutation identity.");
    if (receipt.state === "pending" || receipt.state === "unknown")
      throw new Error(
        "The write outcome is not confirmed. Check the pending write before trying again.",
      );
    this.pending.delete(mutation);
    if (receipt.state === "rejected")
      throw receipt.problem
        ? new MdbaseError(receipt.problem)
        : new Error("The task change was rejected.");
    if (receipt.status === "conflicted")
      throw new Error(
        "This change has a conflict. Resolve it in TaskNotes before planning.",
      );
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

  private emit(): void {
    this.generation++;
    for (const listener of this.listeners) listener();
  }
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
