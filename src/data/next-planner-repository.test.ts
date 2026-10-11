import {
  connect,
  MdbaseError,
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

  it("writes canonical schedule fields through the task contract and waits for confirmation/readback", async () => {
    const f = await fixture();
    const [item] = (await f.repo.load()).tasks;
    const update = vi.spyOn(f.client, "update");
    const get = vi.spyOn(f.client, "get");
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
      expect.objectContaining({
        mutationId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(get).toHaveBeenLastCalledWith(
      f.record.id,
      { effective: true },
      expect.any(AbortSignal),
    );
    const stored = await f.client.get(f.record.id, { effective: true });
    expect(stored.frontmatter.get("starts")).toBe("2026-10-10");
    expect(stored.frontmatter.get("ends")).toBe("2026-10-12");
    expect(f.repo.pendingMutations()).toEqual([]);
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

  it("retains an unknown mutation for receipt-only recovery, never a new update", async () => {
    const f = await fixture();
    const [item] = (await f.repo.load()).tasks;
    const update = vi.spyOn(f.client, "update").mockRejectedValue(
      new MdbaseError({
        code: "outcome_unknown",
        recovery: "resolve_outcome",
        message: "Unknown write",
      }),
    );
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
    const [pending] = f.repo.pendingMutations();
    expect(pending.operation).toBe("update");
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-13" }),
    ).rejects.toThrow("pending write");
    const receipt = vi.spyOn(f.client, "awaitReceipt").mockResolvedValue({
      mutation: pending.requestId,
      state: "confirmed",
      status: "applied",
    });
    await f.repo.recoverPendingMutation(pending.requestId);
    expect(receipt).toHaveBeenCalledWith(
      pending.requestId,
      30000,
      expect.any(AbortSignal),
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(f.repo.pendingMutations()).toEqual([]);
  });

  it("does not report pending receipts as saved or resubmit during recovery", async () => {
    const f = await fixture({ pending: true });
    const [item] = (await f.repo.load()).tasks;
    const original = f.client.update.bind(f.client);
    let mutation = "";
    const update = vi
      .spyOn(f.client, "update")
      .mockImplementation(async (...args) => {
        const write = await original(...args);
        mutation = write.mutationId;
        return write;
      });
    const receipt = vi
      .spyOn(f.client, "awaitReceipt")
      .mockImplementation(async (id) => ({ mutation: id, state: "pending" }));
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toThrow("not confirmed");
    await expect(f.repo.recoverPendingMutation(mutation)).rejects.toThrow(
      "not confirmed",
    );
    expect(update).toHaveBeenCalledTimes(1);
    receipt.mockRestore();
    f.replica.confirmAll();
    await f.repo.recoverPendingMutation(mutation);
    expect(f.repo.pendingMutations()).toEqual([]);
  });

  it("retains an actual captured mutation after an ambiguous internal SDK response error", async () => {
    const f = await fixture({ pending: true });
    const [item] = (await f.repo.load()).tasks;
    const original = f.client.update.bind(f.client);
    let captured = "";
    const update = vi
      .spyOn(f.client, "update")
      .mockImplementation(async (record, changes, options) => {
        const write = await original(record, changes, options);
        captured = write.mutationId;
        throw new MdbaseError({
          code: "internal",
          recovery: "contact_support",
          reason: "invalid_submit_result",
          message: "Post-capture response error",
        });
      });
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toMatchObject({ code: "internal" });
    expect(
      (await f.client.pendingWrites()).some(
        (pending) => pending.receipt.mutation === captured,
      ),
    ).toBe(true);
    expect(f.repo.pendingMutations()).toEqual([
      expect.objectContaining({ requestId: captured }),
    ]);
    f.replica.confirmAll();
    await f.repo.recoverPendingMutation(captured);
    expect(update).toHaveBeenCalledTimes(1);
    expect(f.repo.pendingMutations()).toEqual([]);
  });

  it("retains the original write when confirmed receipt readback has another genuine pending edit", async () => {
    const f = await fixture({ pending: true });
    const [item] = (await f.repo.load()).tasks;
    const originalReceipt = f.client.awaitReceipt.bind(f.client);
    const receipt = vi
      .spyOn(f.client, "awaitReceipt")
      .mockImplementation(async (mutation, timeout, signal) => {
        f.replica.confirmAll();
        const confirmed = await originalReceipt(mutation, timeout, signal);
        expect(confirmed.state).toBe("confirmed");
        const current = await f.client.get(f.record.id, { effective: true });
        await f.client.update(current, {
          patch: { headline: "Other pending edit" },
          ifRevision: current.revision,
        });
        expect((await f.client.get(f.record.id)).state.state).toBe("pending");
        return confirmed;
      });
    const update = vi.spyOn(f.client, "update");
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toThrow("current task is pending or protected");
    const [pending] = f.repo.pendingMutations();
    expect(pending).toBeDefined();
    receipt.mockRestore();
    f.replica.confirmAll();
    await f.repo.recoverPendingMutation(pending.requestId);
    expect(update).toHaveBeenCalledTimes(2); // own write + independent consumer
    expect(f.repo.pendingMutations()).toEqual([]);
  });

  it("retains a confirmed task write when readback fails and recovers without another update", async () => {
    const f = await fixture({ pending: true });
    const [item] = (await f.repo.load()).tasks;
    const originalReceipt = f.client.awaitReceipt.bind(f.client);
    const receipt = vi
      .spyOn(f.client, "awaitReceipt")
      .mockImplementation(async (mutation, timeout, signal) => {
        f.replica.confirmAll();
        const confirmed = await originalReceipt(mutation, timeout, signal);
        vi.spyOn(f.client, "get").mockRejectedValueOnce(
          new MdbaseError({
            code: "unavailable",
            recovery: "retry",
            message: "Readback unavailable",
          }),
        );
        return confirmed;
      });
    const update = vi.spyOn(f.client, "update");
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toThrow("Readback unavailable");
    const [pending] = f.repo.pendingMutations();
    expect(pending).toBeDefined();
    receipt.mockRestore();
    await f.repo.recoverPendingMutation(pending.requestId);
    expect(update).toHaveBeenCalledTimes(1);
    expect(f.repo.pendingMutations()).toEqual([]);
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

  it("forwards source pending identities and recovery without using task receipt recovery", async () => {
    const f = await fixture();
    await f.repo.load();
    const requestId = crypto.randomUUID();
    let active = true;
    f.views.pendingMutations = () =>
      active
        ? [
            {
              requestId,
              operation: "view-update",
              createdAt: new Date().toISOString(),
            },
          ]
        : [];
    f.views.recoverPendingMutation = vi.fn(async () => {
      active = false;
    });
    const receipt = vi.spyOn(f.client, "awaitReceipt");
    expect(f.repo.pendingMutations()).toEqual([
      expect.objectContaining({ requestId }),
    ]);
    await f.repo.recoverPendingMutation(requestId);
    expect(f.views.recoverPendingMutation).toHaveBeenCalledWith(
      requestId,
      expect.any(AbortSignal),
    );
    expect(receipt).not.toHaveBeenCalled();
    expect(f.repo.pendingMutations()).toEqual([]);
  });

  it("blocks task capture during view preflight and releases the boundary after refusal", async () => {
    const f = await fixture();
    const [item] = (await f.repo.load()).tasks;
    let reject!: (error: Error) => void;
    f.views.save = vi.fn(
      () =>
        new Promise<PlannerView>((_resolve, failed) => {
          reject = failed;
        }),
    );
    const save = f.repo.saveView({ name: "Work" });
    const failed = expect(save).rejects.toThrow("Source refusal");
    const update = vi.spyOn(f.client, "update");
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toThrow("pending write");
    expect(update).not.toHaveBeenCalled();
    reject(new Error("Source refusal"));
    await failed;
    expect((await f.repo.updateSchedule(item, { due: "2026-10-12" })).due).toBe(
      "2026-10-12",
    );
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

  it("retains the original admitted provider witness during live recovery", async () => {
    const f = await fixture();
    const catalog = await f.client.describe();
    const originalType = catalog.types[0];
    vi.mocked(f.client.describe).mockResolvedValue({
      ...catalog,
      types: [...catalog.types, { ...originalType, name: "alternate-task" }],
    });
    const [item] = (await f.repo.load()).tasks;
    const original = f.client.get.bind(f.client);
    vi.spyOn(f.client, "get").mockImplementation(async (...args) => {
      const current = await original(...args);
      return args[0] === f.record.id
        ? { ...current, types: ["alternate-task"] }
        : current;
    });
    const update = vi.spyOn(f.client, "update");
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toThrow("portable identity");
    const [pending] = f.repo.pendingMutations();
    await expect(
      f.repo.recoverPendingMutation(pending.requestId),
    ).rejects.toThrow("portable identity");
    expect(f.repo.pendingMutations()).toEqual([pending]);
    expect(update).toHaveBeenCalledTimes(1);
  });

  // Clients' independent regression: readback is mocked, not native proof.
  it("uses the original portable identity witness during live task recovery too", async () => {
    const f = await fixture();
    const [item] = (await f.repo.load()).tasks;
    const original = f.client.get.bind(f.client);
    vi.spyOn(f.client, "get").mockImplementation(async (...args) => {
      const current = await original(...args);
      if (args[0] !== f.record.id) return current;
      return {
        ...current,
        frontmatter: new Map(current.frontmatter).set("id", "replacement"),
        effective: new Map(current.effective ?? current.frontmatter).set(
          "id",
          "replacement",
        ),
      };
    });
    const update = vi.spyOn(f.client, "update");
    await expect(
      f.repo.updateSchedule(item, { due: "2026-10-12" }),
    ).rejects.toThrow("saved task changed its portable identity");
    const [pending] = f.repo.pendingMutations();
    expect(pending).toBeDefined();
    await expect(
      f.repo.recoverPendingMutation(pending.requestId),
    ).rejects.toThrow();
    expect(f.repo.pendingMutations()).toEqual([pending]);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
