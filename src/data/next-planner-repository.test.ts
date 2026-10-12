import {
  connect,
  toValue,
  type MdbaseClient,
  type wire,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model";
import { NextPlannerRepository } from "./next-planner-repository";
import type { NextPlannerViewAccess } from "./next-planner-views";
import type { PlannerView } from "../domain/task";

const clients: MdbaseClient[] = [];
const repositories: NextPlannerRepository[] = [];
afterEach(() => {
  for (const repo of repositories.splice(0)) repo.dispose();
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
});

const todoFields = {
  id: "id",
  title: "headline",
  status: "state",
  priority: "urgency",
  projects: "teams",
  scheduled: "starts",
  due: "ends",
  blockedBy: "dependencies",
  completedDate: "finished",
};

async function fixture(options: { pending?: boolean } = {}) {
  const replica = new MemoryReplica({
    confirmDelayMs: options.pending ? null : 0,
    contracts: [
      {
        id: "tasknotes.task",
        version: TASKNOTES_SPEC_VERSION,
        type: "todo",
        fields: todoFields,
      },
    ],
  });
  const record = replica.seed({
    path: "work/plan.md",
    types: ["todo"],
    frontmatter: {
      id: "portable-plan",
      headline: "Plan launch",
      state: "open",
      urgency: "normal",
      teams: ["work"],
    },
    body: "Never fetch this body for a timeline.",
  });
  replica.seed({
    path: "notes/other.md",
    types: ["note"],
    frontmatter: { headline: "Not a task" },
  });
  const client = await connect({
    connector: replica.connector(),
    app: { name: "planner-test", version: "test" },
    reconnect: false,
  });
  clients.push(client);
  const catalog: wire.DescribeResult = {
    specVersion: "0.3.0",
    inclusion: { include: [] },
    issues: [],
    settings: new Map(),
    contracts: [
      {
        id: "tasknotes.task",
        version: TASKNOTES_SPEC_VERSION,
        digest: TASKNOTES_CONTRACT_DIGEST,
        path: "_contracts/tasknotes.task.md",
        contractType: "record",
        implementedBy: ["todo"],
      },
    ],
    types: [
      {
        name: "todo",
        path: "_types/todo.md",
        implements: [
          {
            contract: "tasknotes.task",
            version: TASKNOTES_SPEC_VERSION,
            fields: new Map(Object.entries(todoFields)),
            binding: toValue({
              status: {
                default: "open",
                definitions: [
                  {
                    value: "open",
                    label: "Open",
                    color: "#64748b",
                    order: 0,
                    is_completed: false,
                  },
                  {
                    value: "done",
                    label: "Done",
                    color: "#22c55e",
                    order: 1,
                    is_completed: true,
                  },
                ],
              },
              priority: {
                default: "normal",
                definitions: [{ value: "normal", label: "Normal", weight: 1 }],
              },
            }),
          },
        ],
      },
    ],
  };
  // MemoryReplica is a protocol stand-in, not a native contract/Bases parser.
  vi.spyOn(client, "describe").mockResolvedValue(catalog);
  const views: NextPlannerViewAccess = {
    list: vi.fn(async () => []),
    execute: vi.fn(async () => []),
    save: vi.fn(),
  };
  const repo = new NextPlannerRepository(client, "Work", views);
  repositories.push(repo);
  return { replica, client, record, catalog, views, repo };
}

describe("NextPlannerRepository (SDK stand-in, not LAB)", () => {
  it("loads only exact contract implementing types, with effective metadata and no bodies", async () => {
    const f = await fixture();
    const query = vi.spyOn(f.client, "query");
    const get = vi.spyOn(f.client, "get");
    const collection = await f.repo.load();
    expect(collection.id).toBe(f.replica.collection);
    expect(collection.name).toBe("Work");
    expect(collection.tasks).toHaveLength(1);
    expect(collection.tasks[0]).toMatchObject({
      id: "portable-plan",
      title: "Plan launch",
      providerType: "todo",
      status: "open",
      projects: ["work"],
    });
    expect(query).toHaveBeenCalledWith(
      { types: ["todo"], limit: 1000 },
      { effective: true },
      expect.any(AbortSignal),
    );
    expect(get).not.toHaveBeenCalled();
  });

  it.each(["digest", "version"] as const)(
    "refuses a different contract %s without a type-name fallback",
    async (field) => {
      const f = await fixture();
      f.catalog.contracts[0][field] = "wrong";
      await expect(f.repo.load()).rejects.toThrow(
        "does not provide tasknotes.task",
      );
      expect(f.views.list).not.toHaveBeenCalled();
    },
  );

  it("refuses absent and ambiguous implementations", async () => {
    const f = await fixture();
    f.catalog.types[0].implements.push(f.catalog.types[0].implements[0]);
    await expect(f.repo.load()).rejects.toThrow("ambiguous");
    f.catalog.types[0].implements = [];
    await expect(f.repo.load()).rejects.toThrow("no implementing types");
  });

  it("does not publish an incomplete query or duplicate portable identity", async () => {
    const f = await fixture();
    const original = f.client.query.bind(f.client);
    vi.spyOn(f.client, "query").mockImplementation(async (...args) => ({
      ...(await original(...args)),
      complete: false,
    }));
    await expect(f.repo.load()).rejects.toThrow("complete task index");
    vi.mocked(f.client.query).mockRestore();
    f.replica.seed({
      path: "work/duplicate.md",
      types: ["todo"],
      frontmatter: { id: "portable-plan" },
    });
    await expect(f.repo.load()).rejects.toThrow("same portable identity");
  });

  it("writes canonical schedule fields through the task contract", async () => {
    const f = await fixture();
    const [item] = (await f.repo.load()).tasks;
    const update = vi.spyOn(f.client, "update");
    const saved = await f.repo.updateSchedule(item, {
      scheduled: "2026-10-10",
      due: "2026-10-12",
    });
    expect(saved).toMatchObject({ scheduled: "2026-10-10", due: "2026-10-12" });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: f.record.id }),
      expect.objectContaining({
        contract: {
          id: "tasknotes.task",
          version: TASKNOTES_SPEC_VERSION,
          type: "todo",
        },
        patch: { scheduled: "2026-10-10", due: "2026-10-12" },
        ifRevision: expect.any(String),
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const stored = await f.client.get(f.record.id, { effective: true });
    expect(stored.frontmatter.get("starts")).toBe("2026-10-10");
    expect(stored.frontmatter.get("ends")).toBe("2026-10-12");
  });

  it("keeps editing while writes are saved on this device, and lists a later refusal", async () => {
    const f = await fixture({ pending: true });
    const save = f.client.save.bind(f.client);
    vi.spyOn(f.client, "save").mockImplementation((write, options) =>
      save(write, { ...options, timeoutMs: 10 }),
    );
    const [item] = (await f.repo.load()).tasks;
    const changed = vi.fn();
    await f.repo.watch(changed);
    const first = await f.repo.updateSchedule(item, { due: "2026-10-12" });
    expect(first.due).toBe("2026-10-12");
    const [reloaded] = (await f.repo.load()).tasks;
    const second = await f.repo.updateSchedule(reloaded, { due: "2026-10-13" });
    expect(second.due).toBe("2026-10-13");
    expect(f.client.ledger.getSnapshot().pending).toHaveLength(2);
    expect(f.repo.rejectedWrites()).toEqual([]);

    const [refused] = f.client.ledger.getSnapshot().pending;
    changed.mockClear();
    f.replica.reject(refused.mutationId, {
      code: "conflict",
      recovery: "refresh",
      message: "Changed elsewhere",
    });
    await vi.waitFor(() =>
      expect(f.repo.rejectedWrites()).toEqual([
        { id: refused.mutationId, message: "Changed elsewhere" },
      ]),
    );
    expect(changed).toHaveBeenCalled();
    await f.repo.dismissRejectedWrite(refused.mutationId);
    expect(f.repo.rejectedWrites()).toEqual([]);
  });

  it("preserves portable completion behavior and customized fields", async () => {
    const f = await fixture();
    const [item] = (await f.repo.load()).tasks;
    const saved = await f.repo.toggleCompletion(item);
    expect(saved).toMatchObject({ status: "done", completed: true });
    const result = await f.client.get(f.record.id, { effective: true });
    expect(result.frontmatter.get("finished")).toMatch(
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
    );
    expect(result.frontmatter.has("completedDate")).toBe(false);
  });

  it("rejects invalid options before any submission", async () => {
    const f = await fixture();
    const [item] = (await f.repo.load()).tasks;
    const update = vi.spyOn(f.client, "update");
    await expect(
      f.repo.updateProperties(item, { status: "unknown" }),
    ).rejects.toThrow("not available");
    expect(update).not.toHaveBeenCalled();
  });

  it("surfaces a rejected or conflicted receipt rather than optimistic success", async () => {
    const f = await fixture();
    const [item] = (await f.repo.load()).tasks;
    vi.spyOn(f.client, "awaitReceipt").mockImplementation(async (mutation) => ({
      mutation,
      state: "rejected",
      problem: {
        code: "conflict",
        recovery: "refresh",
        message: "Changed at head",
      },
    }));
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toThrow("Changed at head");
  });

  it("does not write a task whose portable identity was replaced at the same path", async () => {
    const f = await fixture();
    const [item] = (await f.repo.load()).tasks;
    const original = await f.client.get(f.record.id, { effective: true });
    vi.spyOn(f.client, "get").mockResolvedValue({
      ...original,
      frontmatter: new Map(original.frontmatter).set("id", "replacement"),
      effective: new Map(original.effective ?? original.frontmatter).set(
        "id",
        "replacement",
      ),
    });
    const update = vi.spyOn(f.client, "update");
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toThrow("changed its identity");
    expect(update).not.toHaveBeenCalled();
  });

  it("does not publish a late catalog result after repository disposal", async () => {
    const f = await fixture();
    vi.mocked(f.client.describe).mockImplementation(async () => {
      f.repo.dispose();
      return f.catalog;
    });
    await expect(f.repo.load()).rejects.toMatchObject({ name: "AbortError" });
    expect(f.views.list).not.toHaveBeenCalled();
  });

  it("executes the chosen saved view rather than silently falling back to all tasks", async () => {
    const f = await fixture();
    const view: PlannerView = {
      key: "uuid#2",
      path: "work/base.base",
      id: "2",
      name: "Work",
      revision: "hash",
      format: "obsidian.base",
      writable: false,
      options: {},
    };
    vi.mocked(f.views.list).mockResolvedValue([view]);
    vi.mocked(f.views.execute).mockResolvedValue([
      await f.client.get(f.record.id, { effective: true }),
    ]);
    const query = vi.spyOn(f.client, "query");
    const loaded = await f.repo.load(view.key);
    expect(loaded.activeView).toEqual(view);
    expect(query).not.toHaveBeenCalled();
    expect(f.views.execute).toHaveBeenCalledWith(view, expect.any(AbortSignal));
    await expect(f.repo.load("missing")).rejects.toThrow("no longer available");
  });
});
