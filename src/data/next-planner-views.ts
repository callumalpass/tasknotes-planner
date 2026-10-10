import { MdbaseError, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import type { AppBasesDescriptor } from "@mdbase-dev/sdk/app-host";
import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parse,
  parseDocument,
  visit,
} from "yaml";
import type {
  PendingPlannerMutation,
  PlannerView,
  SavePlannerViewInput,
} from "../domain/task";

export interface NextPlannerViewAccess {
  list(signal: AbortSignal): Promise<PlannerView[]>;
  execute(view: PlannerView, signal: AbortSignal): Promise<wire.RecordView[]>;
  save(
    input: SavePlannerViewInput,
    document: string,
    signal: AbortSignal,
  ): Promise<PlannerView>;
  pendingMutations?(): readonly PendingPlannerMutation[];
  recoverPendingMutation?(
    requestId: string,
    signal: AbortSignal,
  ): Promise<void>;
  restorePending?(
    mutations: Awaited<ReturnType<MdbaseClient["pendingWrites"]>>,
  ): void;
}

interface SourceMutation extends PendingPlannerMutation {
  recordId: string;
  ordinal?: number;
  name?: string;
}

/** Native view identity is UUID + source SHA + original declaration ordinal.
 * Names and paths are presentation only, never execution selectors. */
export class NextPlannerViews implements NextPlannerViewAccess {
  private descriptors = new Map<string, AppBasesDescriptor>();
  private readonly pending = new Map<string, SourceMutation>();

  constructor(private readonly client: MdbaseClient) {}

  async list(signal: AbortSignal): Promise<PlannerView[]> {
    const captureTimezone = timezone();
    const descriptors = new Map<string, AppBasesDescriptor>();
    const views: PlannerView[] = [];
    const sourceRecords = new Map<string, wire.RecordView>();
    let continuation: Uint8Array | null = null;
    let cut: { revision: string; clock: wire.OpClock } | undefined;
    let previous: AppBasesDescriptor | undefined;
    do {
      const page = await this.client.listAppBasesViews(
        { captureTimezone, limit: 128, continuation },
        signal,
      );
      signal.throwIfAborted();
      if (page.kind === "refusal") throw new MdbaseError(page.problem);
      if (
        cut &&
        (cut.revision !== page.collectionRevision ||
          cut.clock.instant !== page.clock.instant ||
          cut.clock.tz !== page.clock.tz ||
          cut.clock.localDate !== page.clock.localDate)
      )
        throw new Error(
          "The saved view catalog changed while loading. Refresh Planner.",
        );
      cut ??= { revision: page.collectionRevision, clock: page.clock };
      for (const descriptor of page.views) {
        if (
          previous &&
          (previous.record > descriptor.record ||
            (previous.record === descriptor.record &&
              (previous.ordinal >= descriptor.ordinal ||
                previous.path !== descriptor.path ||
                previous.sourceRevision !== descriptor.sourceRevision)))
        )
          throw new Error(
            "The saved view catalog changed its source identity.",
          );
        previous = descriptor;
        if (
          !["tasknotesPlanner", "tasknotes.planner"].includes(
            descriptor.viewType,
          )
        )
          continue;
        const key = `${descriptor.record}#${descriptor.ordinal}`;
        const source = await this.source(descriptor, signal, captureTimezone);
        const record =
          sourceRecords.get(descriptor.record) ??
          (await this.client.get(
            descriptor.record,
            { effective: true },
            signal,
          ));
        signal.throwIfAborted();
        if (
          record.id !== descriptor.record ||
          record.path !== descriptor.path ||
          record.revision !== descriptor.sourceRevision
        )
          throw new Error(
            "The saved view source changed while loading. Refresh Planner.",
          );
        sourceRecords.set(record.id, record);
        const value = object(parse(source));
        if (!Array.isArray(value.views))
          throw new Error("The Base source has no view declarations.");
        const selected = object(value.views[descriptor.ordinal]);
        if (
          (typeof selected.name === "string" ? selected.name : null) !==
            descriptor.name ||
          selected.type !== descriptor.viewType
        )
          throw new Error("The Base source changed its selected declaration.");
        const options = object(selected.options ?? {});
        descriptors.set(key, structuredClone(descriptor));
        views.push({
          key,
          path: descriptor.path,
          id: String(descriptor.ordinal),
          name: descriptor.name ?? "Planner",
          format: "obsidian.base",
          revision: descriptor.sourceRevision,
          writable:
            hasSourceGrant(this.client, "records.edit") &&
            writableState(record),
          options: {
            ...(typeof options.zoom === "number" &&
            Number.isFinite(options.zoom)
              ? { zoom: options.zoom }
              : {}),
            ...(typeof options.project === "string"
              ? { project: options.project }
              : {}),
            ...(typeof options.status === "string"
              ? { status: options.status }
              : {}),
            ...(typeof options.priority === "string"
              ? { priority: options.priority }
              : {}),
            ...(typeof options.showCompleted === "boolean"
              ? { showCompleted: options.showCompleted }
              : {}),
          },
        });
      }
      continuation =
        page.continuation === null ? null : page.continuation.slice();
    } while (continuation !== null);
    signal.throwIfAborted();
    this.descriptors = descriptors;
    return views;
  }

  async execute(
    view: PlannerView,
    signal: AbortSignal,
  ): Promise<wire.RecordView[]> {
    const descriptor = this.descriptors.get(view.key);
    if (
      !descriptor ||
      descriptor.path !== view.path ||
      descriptor.sourceRevision !== view.revision ||
      String(descriptor.ordinal) !== view.id
    )
      throw new Error("Refresh this saved view before opening it.");
    const result = await this.client.executeAppBases(
      {
        ...selection(descriptor),
        hints: new Map(),
        captureTimezone: timezone(),
      },
      signal,
    );
    signal.throwIfAborted();
    if (result.kind === "refusal") throw new MdbaseError(result.problem);
    assertIdentity(result.view, descriptor);
    // Keep native order. Bounded parallel metadata reads, never N body reads.
    const records: wire.RecordView[] = new Array(result.rows.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(8, result.rows.length) }, async () => {
        while (next < result.rows.length) {
          signal.throwIfAborted();
          const index = next++;
          const row = result.rows[index];
          const record = await this.client.get(
            row.record,
            { effective: true },
            signal,
          );
          signal.throwIfAborted();
          if (
            record.id !== row.record ||
            record.path !== row.path ||
            record.revision !== row.sourceRevision
          )
            throw new Error(
              "A saved view row changed while loading. Refresh Planner.",
            );
          records[index] = record;
        }
      }),
    );
    return records;
  }

  async save(
    input: SavePlannerViewInput,
    document: string,
    signal: AbortSignal,
  ): Promise<PlannerView> {
    signal.throwIfAborted();
    assertSourceGrant(
      this.client,
      input.view ? "records.edit" : "records.create",
    );
    if (this.pending.size)
      throw new Error(
        "Recover the pending view write before saving another view.",
      );
    const name = input.name;
    const definition = object(parse(document));
    if (!Array.isArray(definition.views) || definition.views.length !== 1)
      throw new Error(
        "A saved Planner definition must contain exactly one view.",
      );
    const replacement = object(definition.views[0]);
    if (
      !plannerType(replacement.type) ||
      replacement.name !== name ||
      !name.trim()
    )
      throw new Error(
        "The saved definition does not match the requested Planner view.",
      );

    let base: wire.RecordView | undefined;
    let ordinal = 0;
    let recordId: string;
    if (input.view) {
      const descriptor = this.descriptors.get(input.view.key);
      if (
        !descriptor ||
        descriptor.path !== input.view.path ||
        descriptor.sourceRevision !== input.view.revision ||
        String(descriptor.ordinal) !== input.view.id
      )
        throw new Error("Refresh this saved view before changing it.");
      base = await this.client.views.getSourceRecord(descriptor.record, {
        signal,
      });
      signal.throwIfAborted();
      if (
        base.id !== descriptor.record ||
        base.path !== descriptor.path ||
        base.revision !== descriptor.sourceRevision
      )
        throw new Error(
          "The saved view source changed. Refresh before saving it.",
        );
      assertWritable(base);
      ordinal = descriptor.ordinal;
      recordId = base.id;
      document = replaceSelected(base.document!, descriptor, replacement);
    } else {
      recordId = crypto.randomUUID();
    }
    signal.throwIfAborted();
    if (this.pending.size)
      throw new Error(
        "Recover the pending view write before saving another view.",
      );
    assertSourceGrant(this.client, base ? "records.edit" : "records.create");
    const mutationId = crypto.randomUUID();
    const mutation: SourceMutation = {
      requestId: mutationId,
      operation: base ? "view-update" : "view-create",
      createdAt: new Date().toISOString(),
      recordId,
      ordinal,
      name,
    };
    this.pending.set(mutationId, mutation);
    // Keep both original identities on every ambiguous SDK failure. The shared
    // helper supplies actual source CAS; no private RPC or read-and-overwrite.
    const write = base
      ? await this.client.views.updateSource(base, document, {
          mutationId,
          signal,
        })
      : await this.client.views.createSource(
          { id: recordId, path: `TaskNotes/Views/${recordId}.base`, document },
          { mutationId, signal },
        );
    signal.throwIfAborted();
    if (write.mutationId !== mutationId)
      throw new Error("The view write changed its mutation identity.");
    const record = await this.confirm(mutation, signal);
    const saved = await this.savedView(mutation, record, signal);
    this.pending.delete(mutationId);
    return saved;
  }

  pendingMutations(): readonly PendingPlannerMutation[] {
    return [...this.pending.values()].map(
      ({ requestId, operation, createdAt }) => ({
        requestId,
        operation,
        createdAt,
      }),
    );
  }

  restorePending(
    mutations: Awaited<ReturnType<MdbaseClient["pendingWrites"]>>,
  ): void {
    for (const mutation of mutations) {
      if (
        mutation.ops.length !== 1 ||
        this.pending.has(mutation.receipt.mutation)
      )
        continue;
      const op = mutation.ops[0];
      if (op.kind !== "create" && op.kind !== "document") continue;
      const document =
        op.kind === "create"
          ? op.document
          : op.kind === "document"
            ? op.new?.doc
            : undefined;
      const path =
        op.kind === "create"
          ? op.path
          : op.kind === "document"
            ? op.new?.path
            : undefined;
      if (
        !path?.toLowerCase().endsWith(".base") ||
        !document ||
        !plannerSource(document)
      )
        continue;
      this.pending.set(mutation.receipt.mutation, {
        requestId: mutation.receipt.mutation,
        operation: op.kind === "create" ? "view-create" : "view-update",
        createdAt: new Date(mutation.captured).toISOString(),
        recordId: op.id,
      });
    }
  }

  async recoverPendingMutation(
    requestId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const mutation = this.pending.get(requestId);
    if (!mutation)
      throw new Error("The exact pending view write is unavailable.");
    const record = await this.confirm(mutation, signal);
    // A live intent retains its selected ordinal/name. Restored native intents
    // can qualify the full source without inventing a lost selected ordinal.
    if (mutation.ordinal !== undefined)
      await this.savedView(mutation, record, signal);
    signal.throwIfAborted();
    this.pending.delete(requestId);
  }

  private async confirm(
    mutation: SourceMutation,
    signal: AbortSignal,
  ): Promise<wire.RecordView> {
    const receipt = await this.client.awaitReceipt(
      mutation.requestId,
      30_000,
      signal,
    );
    signal.throwIfAborted();
    if (receipt.mutation !== mutation.requestId)
      throw new Error("The view receipt changed its mutation identity.");
    if (receipt.state === "pending" || receipt.state === "unknown")
      throw new Error(
        "The view write is not confirmed. Recover its original operation before saving again.",
      );
    if (receipt.state === "rejected" || receipt.status === "conflicted") {
      this.pending.delete(mutation.requestId);
      throw receipt.problem
        ? new MdbaseError(receipt.problem)
        : new Error(
            "Resolve the rejected or conflicted view change before saving again.",
          );
    }
    const record = await this.client.views.getSourceRecord(mutation.recordId, {
      signal,
    });
    signal.throwIfAborted();
    if (record.id !== mutation.recordId)
      throw new Error("The saved view changed its record identity.");
    assertWritable(record);
    return record;
  }

  private async savedView(
    mutation: SourceMutation,
    record: wire.RecordView,
    signal: AbortSignal,
  ): Promise<PlannerView> {
    const views = await this.list(signal);
    const saved = views.find(
      (view) => view.key === `${record.id}#${mutation.ordinal}`,
    );
    if (
      !saved ||
      saved.path !== record.path ||
      saved.revision !== record.revision ||
      saved.name !== mutation.name
    )
      throw new Error(
        "The confirmed view changed its selected declaration. Keep the original operation for recovery.",
      );
    return saved;
  }

  private async source(
    descriptor: AppBasesDescriptor,
    signal: AbortSignal,
    captureTimezone: string,
  ): Promise<string> {
    const result = await this.client.readAppBasesViewSource(
      { ...selection(descriptor), captureTimezone },
      signal,
    );
    signal.throwIfAborted();
    if (result.kind === "refusal") throw new MdbaseError(result.problem);
    assertIdentity(result.view, descriptor);
    return result.source;
  }
}

function plannerType(value: unknown): boolean {
  return value === "tasknotesPlanner" || value === "tasknotes.planner";
}

function hasSourceGrant(
  client: MdbaseClient,
  capability: "records.create" | "records.edit",
): boolean {
  const grant = client.hello.grant;
  return (
    grant.role !== "viewer" &&
    grant.capabilities.includes(capability) &&
    !client.status.incidents.some((incident) => incident.kind === "read_only")
  );
}

function assertSourceGrant(
  client: MdbaseClient,
  capability: "records.create" | "records.edit",
): void {
  if (!hasSourceGrant(client, capability))
    throw new Error(
      "The supplied session does not support this source write. No operation was captured.",
    );
}

function writableState(record: wire.RecordView): boolean {
  return (
    record.state.state === "confirmed" &&
    record.state.hold === undefined &&
    (record.state.unresolved ?? 0) === 0
  );
}

function assertWritable(record: wire.RecordView): void {
  if (!writableState(record))
    throw new Error(
      "The view source is pending or protected. Keep its original operation for recovery.",
    );
}

/** Only Planner-owned fields in the original declaration are changed. Keep root
 * metadata, siblings, renderer aliases and unknown options rather than replacing
 * a multi-view Base with the generated single-view definition. */
function replaceSelected(
  source: string,
  descriptor: AppBasesDescriptor,
  replacement: Record<string, unknown>,
): string {
  const document = parseDocument(source);
  if (document.errors.length)
    throw new Error("The Base source cannot be edited safely.");
  const declarations = document.get("views", true);
  if (!isSeq(declarations))
    throw new Error("The Base source has no editable view declarations.");
  const selected = declarations.items[descriptor.ordinal];
  if (
    !isMap(selected) ||
    (typeof selected.get("name") === "string" ? selected.get("name") : null) !==
      descriptor.name ||
    selected.get("type") !== descriptor.viewType
  )
    throw new Error(
      "The Base source changed its original selected declaration.",
    );
  // An anchored selected map/options/scalar may be referenced by a sibling or
  // root metadata. Reject sharing before mutation/capture rather than changing
  // another declaration through YAML's object identity semantics.
  visit(selected, (_key, node) => {
    if (
      isAlias(node) ||
      ((isMap(node) || isSeq(node) || isScalar(node)) && node.anchor)
    )
      throw new Error(
        "The selected Base declaration uses anchors or aliases and cannot be edited safely.",
      );
  });
  selected.set("name", replacement.name);
  for (const key of ["filters", "order", "sort"]) {
    if (replacement[key] === undefined) selected.delete(key);
    else selected.set(key, document.createNode(replacement[key]));
  }
  const options = object(replacement.options ?? {});
  const current = selected.get("options", true);
  if (current !== undefined && !isMap(current))
    throw new Error("The Base options cannot be edited safely.");
  if (isMap(current)) {
    for (const key of [
      "zoom",
      "project",
      "status",
      "priority",
      "showCompleted",
    ]) {
      if (options[key] === undefined) current.delete(key);
      else current.set(key, document.createNode(options[key]));
    }
  } else selected.set("options", document.createNode(options));
  return document.toString();
}

function plannerSource(source: string): boolean {
  try {
    const value = object(parse(source));
    return (
      Array.isArray(value.views) &&
      value.views.some(
        (view) =>
          view !== null &&
          typeof view === "object" &&
          !Array.isArray(view) &&
          plannerType((view as Record<string, unknown>).type),
      )
    );
  } catch {
    return false;
  }
}

function selection(view: AppBasesDescriptor) {
  return {
    record: view.record,
    sourceRevision: view.sourceRevision,
    ordinal: view.ordinal,
  };
}

function assertIdentity(
  actual: AppBasesDescriptor,
  expected: AppBasesDescriptor,
) {
  if (
    actual.record !== expected.record ||
    actual.path !== expected.path ||
    actual.sourceRevision !== expected.sourceRevision ||
    actual.ordinal !== expected.ordinal ||
    actual.name !== expected.name ||
    actual.viewType !== expected.viewType
  )
    throw new Error("The native saved view changed its selected identity.");
}

function timezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The Base source has invalid presentation metadata.");
  return value as Record<string, unknown>;
}
