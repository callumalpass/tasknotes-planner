import { MdbaseError, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import type { AppBasesDescriptor } from "@mdbase-dev/sdk/app-host";
import { parse } from "yaml";
import type { PlannerView, SavePlannerViewInput } from "../domain/task";

export interface NextPlannerViewAccess {
  list(signal: AbortSignal): Promise<PlannerView[]>;
  execute(view: PlannerView, signal: AbortSignal): Promise<wire.RecordView[]>;
  save(
    input: SavePlannerViewInput,
    document: string,
    signal: AbortSignal,
  ): Promise<PlannerView>;
}

/** Native view identity is UUID + source SHA + original declaration ordinal.
 * Names and paths are presentation only, never execution selectors. */
export class NextPlannerViews implements NextPlannerViewAccess {
  private descriptors = new Map<string, AppBasesDescriptor>();

  constructor(private readonly client: MdbaseClient) {}

  async list(signal: AbortSignal): Promise<PlannerView[]> {
    const captureTimezone = timezone();
    const descriptors = new Map<string, AppBasesDescriptor>();
    const views: PlannerView[] = [];
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
          // Source writes become available only with the shared SDK write API.
          writable: false,
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
    _input: SavePlannerViewInput,
    _document: string,
    signal: AbortSignal,
  ): Promise<PlannerView> {
    signal.throwIfAborted();
    throw new MdbaseError({
      code: "invalid_request",
      recovery: "fix_request",
      reason: "unsupported",
      message:
        "Saving Planner views needs the shared SDK view-source write API. Existing views are read-only in this build.",
    });
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
