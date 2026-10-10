import {
  connect,
  MdbaseError,
  type MdbaseClient,
  type wire,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import type { AppBasesDescriptor } from "@mdbase-dev/sdk/app-host";
import { parse } from "yaml";
import { NextPlannerViews } from "./next-planner-views";

const clients: MdbaseClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
});

const source = `# Keep root metadata
formulas:
  caption: note.title
views:
  - type: table
    name: First
    options:
      custom: untouched
  - 7
  - type: tasknotes.planner
    name: Launch
    limit: 25
    options:
      zoom: 3
      project: old
      custom: preserved
`;
const generated = `views:
  - type: tasknotesPlanner
    name: Updated
    filters: note.state != "done"
    options:
      zoom: 5
      showCompleted: false
`;

async function fixture(pending = false) {
  const replica = new MemoryReplica({ confirmDelayMs: pending ? null : 0 });
  const seeded = replica.seed({ path: "work/plans.base", body: source });
  const client = await connect({
    connector: replica.connector(),
    app: { name: "planner-source-test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  const clock: wire.OpClock = {
    instant: Date.UTC(2026, 9, 10),
    tz: "UTC",
    localDate: "2026-10-10",
  };
  const descriptors = async (
    record: wire.RecordView,
  ): Promise<AppBasesDescriptor[]> => {
    const definition = parse(record.document!) as { views: unknown[] };
    return definition.views.flatMap((view, ordinal) => {
      if (
        !view ||
        typeof view !== "object" ||
        !("type" in view) ||
        typeof view.type !== "string"
      )
        return [];
      return [
        {
          record: record.id,
          path: record.path,
          sourceRevision: record.revision,
          ordinal,
          name:
            "name" in view && typeof view.name === "string" ? view.name : null,
          viewType: view.type,
          implementations: [],
        },
      ];
    });
  };
  // Native AppBases descriptors/source results remain controlled fixtures. The
  // record UUIDs, document revisions, captures and receipts use the real SDK
  // MemoryReplica transport; this is not native parser/renderer or LAB evidence.
  vi.spyOn(client, "listAppBasesViews").mockImplementation(async () => {
    const views: AppBasesDescriptor[] = [];
    for (const row of [...replica.allRecords].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (row.path.endsWith(".base"))
        views.push(
          ...(await descriptors(await client.views.getSourceRecord(row.id))),
        );
    }
    return {
      kind: "success",
      views,
      clock,
      collectionRevision: "b".repeat(64),
      continuation: null,
    };
  });
  vi.spyOn(client, "readAppBasesViewSource").mockImplementation(
    async (request) => {
      const record = await client.views.getSourceRecord(request.record);
      const view = (await descriptors(record)).find(
        (view) => view.ordinal === request.ordinal,
      );
      if (!view || view.sourceRevision !== request.sourceRevision)
        throw new Error("fixture source changed");
      return {
        kind: "success",
        view,
        source: record.document!,
        clock,
        collectionRevision: "b".repeat(64),
      };
    },
  );
  return {
    replica,
    client,
    seeded,
    views: new NextPlannerViews(client),
    signal: new AbortController().signal,
  };
}

function definition(document: string) {
  return parse(document) as {
    formulas: unknown;
    views: Array<Record<string, unknown>>;
  };
}

describe("NextPlannerViews shared source writes (controlled stand-in, not LAB)", () => {
  it("updates the original ordinal with actual full-source CAS and retains siblings/unknown fields", async () => {
    const f = await fixture();
    const [view] = await f.views.list(f.signal);
    const replace = vi.spyOn(f.client, "replaceDocument");
    const saved = await f.views.save(
      { name: "Updated", view },
      generated,
      f.signal,
    );
    const current = await f.client.views.getSourceRecord(f.seeded.id);
    const actual = definition(current.document!);
    expect(saved).toMatchObject({
      key: `${f.seeded.id}#2`,
      id: "2",
      name: "Updated",
      revision: current.revision,
      writable: true,
    });
    expect(actual.formulas).toEqual(definition(source).formulas);
    expect(actual.views.slice(0, 2)).toEqual(
      definition(source).views.slice(0, 2),
    );
    expect(actual.views[2]).toMatchObject({
      type: "tasknotes.planner",
      limit: 25,
      name: "Updated",
      options: { zoom: 5, showCompleted: false, custom: "preserved" },
    });
    expect(actual.views[2].options).not.toHaveProperty("project");
    expect(current.document).toContain("# Keep root metadata");
    expect(replace).toHaveBeenCalledWith(
      expect.objectContaining({
        id: f.seeded.id,
        revision: view.revision,
        document: source,
      }),
      expect.any(String),
      expect.objectContaining({
        mutationId: expect.any(String),
        ifRevision: view.revision,
        include: { document: true },
      }),
    );
    expect(f.views.pendingMutations()).toEqual([]);
  });

  it("refuses a stale native source before submitting a replacement", async () => {
    const f = await fixture();
    const [view] = await f.views.list(f.signal);
    const base = await f.client.views.getSourceRecord(f.seeded.id);
    const write = await f.client.views.updateSource(
      base,
      `${source}\n# Concurrent change\n`,
      { mutationId: crypto.randomUUID() },
    );
    await write.confirmed;
    const update = vi.spyOn(f.client.views, "updateSource");
    await expect(
      f.views.save({ name: "Updated", view }, generated, f.signal),
    ).rejects.toThrow("source changed");
    expect(update).not.toHaveBeenCalled();
    expect(f.views.pendingMutations()).toEqual([]);
  });

  it("refuses incomplete full-source fallback before mutation capture", async () => {
    const f = await fixture();
    const [view] = await f.views.list(f.signal);
    const metadata = await f.client.get(f.seeded.id, { effective: true });
    vi.spyOn(f.client, "get").mockResolvedValue(metadata);
    const update = vi.spyOn(f.client.views, "updateSource");
    await expect(
      f.views.save({ name: "Updated", view }, generated, f.signal),
    ).rejects.toThrow("complete RecordView");
    expect(update).not.toHaveBeenCalled();
    expect(f.views.pendingMutations()).toEqual([]);
  });

  it("refuses a protected current source before any native replacement", async () => {
    const f = await fixture();
    const [view] = await f.views.list(f.signal);
    const current = await f.client.views.getSourceRecord(f.seeded.id);
    // Controlled native-state response; no claim of MemoryReplica hold merging.
    vi.spyOn(f.client, "get").mockResolvedValue({
      ...current,
      state: { ...current.state, unresolved: 1 },
    });
    const update = vi.spyOn(f.client.views, "updateSource");
    await expect(
      f.views.save({ name: "Updated", view }, generated, f.signal),
    ).rejects.toThrow("source is pending or protected");
    expect(update).not.toHaveBeenCalled();
    expect(f.views.pendingMutations()).toEqual([]);
  });

  it("recovers the same captured source mutation after an ambiguous SDK error without resubmission", async () => {
    const f = await fixture(true);
    const [view] = await f.views.list(f.signal);
    const original = f.client.views.updateSource.bind(f.client.views);
    let captured = "";
    const update = vi
      .spyOn(f.client.views, "updateSource")
      .mockImplementation(async (base, document, options) => {
        const write = await original(base, document, options);
        captured = write.mutationId;
        throw new MdbaseError({
          code: "internal",
          recovery: "contact_support",
          reason: "invalid_submit_result",
          message: "Post-capture response error",
        });
      });
    await expect(
      f.views.save({ name: "Updated", view }, generated, f.signal),
    ).rejects.toMatchObject({ code: "internal" });
    expect(
      (await f.client.pendingWrites()).some(
        (write) => write.receipt.mutation === captured,
      ),
    ).toBe(true);
    expect(f.views.pendingMutations()).toEqual([
      expect.objectContaining({
        requestId: captured,
        operation: "view-update",
      }),
    ]);
    await expect(
      f.views.save({ name: "Updated", view }, generated, f.signal),
    ).rejects.toThrow("pending view write");
    f.replica.confirmAll();
    await f.views.recoverPendingMutation(captured, f.signal);
    expect(update).toHaveBeenCalledTimes(1);
    expect(f.views.pendingMutations()).toEqual([]);
  });

  it("does not publish a confirmed receipt's pending current source as a saved view", async () => {
    const f = await fixture(true);
    const [view] = await f.views.list(f.signal);
    const original = f.client.awaitReceipt.bind(f.client);
    const receipt = vi
      .spyOn(f.client, "awaitReceipt")
      .mockImplementation(async (mutation, timeout, signal) => {
        f.replica.confirmAll();
        const confirmed = await original(mutation, timeout, signal);
        const current = await f.client.views.getSourceRecord(f.seeded.id);
        await f.client.views.updateSource(
          current,
          `${current.document}\n# Other pending source change\n`,
          { mutationId: crypto.randomUUID() },
        );
        expect(
          (await f.client.views.getSourceRecord(f.seeded.id)).state.state,
        ).toBe("pending");
        return confirmed;
      });
    await expect(
      f.views.save({ name: "Updated", view }, generated, f.signal),
    ).rejects.toThrow("source is pending or protected");
    const [pending] = f.views.pendingMutations();
    expect(pending).toBeDefined();
    receipt.mockRestore();
    f.replica.confirmAll();
    await f.views.recoverPendingMutation(pending.requestId, f.signal);
    expect(f.views.pendingMutations()).toEqual([]);
  });

  it("restores native source intent UUIDs without inventing the lost selected ordinal", async () => {
    const f = await fixture(true);
    const base = await f.client.views.getSourceRecord(f.seeded.id);
    const write = await f.client.views.updateSource(
      base,
      `${source}\n# Captured\n`,
      { mutationId: crypto.randomUUID() },
    );
    const reopened = new NextPlannerViews(f.client);
    reopened.restorePending(await f.client.pendingWrites());
    expect(reopened.pendingMutations()).toEqual([
      expect.objectContaining({
        requestId: write.mutationId,
        operation: "view-update",
      }),
    ]);
    f.replica.confirmAll();
    const submit = vi.spyOn(f.client, "submit");
    await reopened.recoverPendingMutation(write.mutationId, f.signal);
    expect(submit).not.toHaveBeenCalled();
    expect(reopened.pendingMutations()).toEqual([]);
  });

  it("creates a separate source with original record/MID identities rather than overwriting an existing name", async () => {
    const f = await fixture();
    const original = f.client.create.bind(f.client);
    // MemoryReplica ignores create.document in this qualified SDK archive. This
    // explicit fixture bridge supplies body bytes without pretending to prove
    // native source creation; the actual complete document input stays asserted.
    const create = vi
      .spyOn(f.client, "create")
      .mockImplementation((input, options) =>
        original({ ...input, body: input.document }, options),
      );
    const saved = await f.views.save({ name: "Updated" }, generated, f.signal);
    expect(saved).toMatchObject({ id: "0", name: "Updated", writable: true });
    expect(saved.path).toMatch(/^TaskNotes\/Views\/[0-9a-f-]{36}\.base$/);
    expect(create).toHaveBeenCalledWith(
      { id: saved.key.split("#")[0], path: saved.path, document: generated },
      expect.objectContaining({
        mutationId: expect.any(String),
        include: { document: true },
      }),
    );
    expect((await f.client.views.getSourceRecord(f.seeded.id)).document).toBe(
      source,
    );
    expect(
      f.replica.allRecords.filter((record) => record.path.endsWith(".base")),
    ).toHaveLength(2);
  });
});
