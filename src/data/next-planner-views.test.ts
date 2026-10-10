import { connect, type MdbaseClient, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import type {
  AppBasesDescriptor,
  AppBasesDiscoveryResult,
  AppBasesResult,
} from "@mdbase-dev/sdk/app-host";
import { NextPlannerViews } from "./next-planner-views";

const clients: MdbaseClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
});

async function fixture() {
  const replica = new MemoryReplica();
  const record = replica.seed({
    path: "work/task.md",
    types: ["todo"],
    frontmatter: { title: "Plan" },
  });
  const client = await connect({
    connector: replica.connector(),
    app: { name: "planner-views-test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  const descriptor: AppBasesDescriptor = {
    record: crypto.randomUUID(),
    path: "work/plans.base",
    sourceRevision: "a".repeat(64),
    ordinal: 2,
    name: "Launch",
    viewType: "tasknotesPlanner",
    implementations: [],
  };
  const clock: wire.OpClock = {
    instant: Date.UTC(2026, 9, 10),
    tz: "UTC",
    localDate: "2026-10-10",
  };
  const discovery = vi.spyOn(client, "listAppBasesViews").mockResolvedValue({
    kind: "success",
    views: [descriptor],
    clock,
    collectionRevision: "b".repeat(64),
    continuation: null,
  });
  const source = vi.spyOn(client, "readAppBasesViewSource").mockResolvedValue({
    kind: "success",
    view: descriptor,
    source:
      "views:\n  - type: table\n    name: First\n  - type: cards\n    name: Second\n  - type: tasknotesPlanner\n    name: Launch\n    options:\n      zoom: 4\n      project: work\n      showCompleted: false\n",
    clock,
    collectionRevision: "b".repeat(64),
  });
  const view = await client.get(record.id, { effective: true });
  const result: AppBasesResult = {
    kind: "success",
    view: descriptor,
    columns: [],
    unavailableColumns: [],
    rows: [
      {
        record: view.id,
        path: view.path,
        sourceRevision: view.revision,
        cells: [],
      },
    ],
    groups: [],
    clock,
    collectionRevision: "b".repeat(64),
  };
  const execute = vi.spyOn(client, "executeAppBases").mockResolvedValue(result);
  return {
    replica,
    client,
    descriptor,
    clock,
    discovery,
    source,
    execute,
    result,
    views: new NextPlannerViews(client),
  };
}

describe("NextPlannerViews (native results mocked, not LAB/runtime support)", () => {
  it("uses the original ordinal and exact source options, never a slug/name selector", async () => {
    const f = await fixture();
    const [view] = await f.views.list(new AbortController().signal);
    expect(view).toMatchObject({
      key: `${f.descriptor.record}#2`,
      id: "2",
      name: "Launch",
      writable: false,
      options: { zoom: 4, project: "work", showCompleted: false },
    });
    expect(f.source).toHaveBeenCalledWith(
      expect.objectContaining({
        record: f.descriptor.record,
        sourceRevision: f.descriptor.sourceRevision,
        ordinal: 2,
      }),
      expect.any(AbortSignal),
    );
    const rows = await f.views.execute(view, new AbortController().signal);
    expect(rows).toHaveLength(1);
    expect(f.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        record: f.descriptor.record,
        sourceRevision: f.descriptor.sourceRevision,
        ordinal: 2,
        hints: new Map(),
      }),
      expect.any(AbortSignal),
    );
  });

  it("continues after an empty page and preserves the native cut", async () => {
    const f = await fixture();
    const page: AppBasesDiscoveryResult = {
      kind: "success",
      views: [],
      clock: f.clock,
      collectionRevision: "b".repeat(64),
      continuation: new Uint8Array([1]),
    };
    f.discovery.mockResolvedValueOnce(page);
    expect(await f.views.list(new AbortController().signal)).toHaveLength(1);
    expect(f.discovery).toHaveBeenCalledTimes(2);
    expect(f.discovery.mock.calls[1][0].continuation).toEqual(
      new Uint8Array([1]),
    );
  });

  it("refuses a changed continuation cut instead of publishing partial discovery", async () => {
    const f = await fixture();
    f.discovery.mockResolvedValueOnce({
      kind: "success",
      views: [],
      clock: { ...f.clock, instant: f.clock.instant - 1 },
      collectionRevision: "b".repeat(64),
      continuation: new Uint8Array([1]),
    });
    await expect(f.views.list(new AbortController().signal)).rejects.toThrow(
      "catalog changed",
    );
  });

  it("does not fall back to generic views RPC when native discovery refuses", async () => {
    const f = await fixture();
    const generic = vi.spyOn(f.client.views, "list");
    f.discovery.mockResolvedValue({
      kind: "refusal",
      problem: {
        code: "invalid_request",
        reason: "unsupported",
        recovery: "fix_request",
        message: "Native unavailable",
      },
    });
    await expect(f.views.list(new AbortController().signal)).rejects.toThrow(
      "Native unavailable",
    );
    expect(generic).not.toHaveBeenCalled();
  });

  it("refuses a source reply with a different identity or original ordinal declaration", async () => {
    const f = await fixture();
    const current = await f.client.readAppBasesViewSource({
      record: f.descriptor.record,
      sourceRevision: f.descriptor.sourceRevision,
      ordinal: 2,
      captureTimezone: "UTC",
    });
    if (current.kind !== "success") throw new Error("fixture");
    f.source.mockResolvedValue({
      ...current,
      view: { ...f.descriptor, ordinal: 0 },
    });
    await expect(f.views.list(new AbortController().signal)).rejects.toThrow(
      "selected identity",
    );
    f.source.mockResolvedValue({ ...current, source: "views: []" });
    await expect(f.views.list(new AbortController().signal)).rejects.toThrow(
      "invalid presentation",
    );
  });

  it("refuses a row whose revision changed before metadata readback", async () => {
    const f = await fixture();
    const signal = new AbortController().signal;
    const [view] = await f.views.list(signal);
    if (f.result.kind !== "success") throw new Error("fixture");
    f.execute.mockResolvedValue({
      ...f.result,
      rows: [{ ...f.result.rows[0], sourceRevision: "wrong" }],
    });
    await expect(f.views.execute(view, signal)).rejects.toThrow("row changed");
  });

  it("does not silently create view records before the generic source-write API exists", async () => {
    const f = await fixture();
    const create = vi.spyOn(f.client, "create");
    await expect(
      f.views.save(
        { name: "Launch" },
        "views: []",
        new AbortController().signal,
      ),
    ).rejects.toThrow("shared SDK view-source write API");
    expect(create).not.toHaveBeenCalled();
  });
});
