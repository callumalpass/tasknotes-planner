import { type JsonObject, type MdbaseConnection } from "@mdbase-dev/connect";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { parse } from "yaml";

import { MdbasePlannerRepository } from "./mdbase-repository";

describe("MdbasePlannerRepository", () => {
  it("creates a tasknotesPlanner Base from contract-defined filters", async () => {
    const createViewSource = vi.fn(async (input: { document: string }) =>
      success({
        path: "TaskNotes/Views/high-work.base",
        format: "obsidian.base",
        revision: "view-1",
        document: input.document,
      }),
    );
    const update = vi.fn(async (input: { patch: JsonObject }) =>
      success({
        path: "tasks/plan.md",
        revision: "task-2",
        types: ["task"],
        contract: {
          id: "tasknotes.task",
          version: "0.3.0-rc.3",
          type: "task",
        },
        effectiveFrontmatter: {
          id: "plan",
          title: "Plan launch",
          status: "open",
          priority: "normal",
          ...input.patch,
        },
      }),
    );
    const connection = {
      describe: vi.fn(async () =>
        success({
          collectionId: "collection-1",
          displayName: "Work",
          changeCursor: 4,
          contracts: [
            {
              id: "tasknotes.task",
              version: "0.3.0-rc.3",
              digest: TASKNOTES_CONTRACT_DIGEST,
              implementations: [
                {
                  typeName: "task",
                  fields: {
                    id: "id",
                    title: "title",
                    status: "status",
                    priority: "priority",
                    scheduled: "scheduled",
                    due: "due",
                    projects: "projects",
                  },
                  binding: {
                    status: {
                      default: "open",
                      definitions: [
                        {
                          value: "open",
                          label: "Open",
                          color: "#64748b",
                          order: 1,
                          is_completed: false,
                          is_skipped: false,
                        },
                        {
                          value: "done",
                          label: "Done",
                          color: "#22c55e",
                          order: 2,
                          is_completed: true,
                          is_skipped: false,
                        },
                      ],
                    },
                    priority: {
                      default: "normal",
                      definitions: [
                        {
                          value: "normal",
                          label: "Normal",
                          color: "#f59e0b",
                          weight: 2,
                        },
                        {
                          value: "high",
                          label: "High",
                          color: "#ef4444",
                          weight: 3,
                        },
                      ],
                    },
                    archive: { archived_tag: "archived" },
                  },
                },
              ],
            },
          ],
        }),
      ),
      listViews: vi.fn(async () =>
        success({ views: [], meta: { totalCount: 0 } }),
      ),
      queryAll: vi.fn(async () =>
        success({
          results: [
            {
              path: "tasks/plan.md",
              revision: "task-1",
              types: ["task"],
              effectiveFrontmatter: {
                id: "plan",
                title: "Plan launch",
                status: "open",
                priority: "normal",
              },
            },
          ],
          meta: { totalCount: 1, hasMore: false },
        }),
      ),
      read: vi.fn(async () =>
        success({
          path: "tasks/plan.md",
          revision: "task-1",
          types: ["task"],
          effectiveFrontmatter: {
            id: "plan",
            title: "Plan launch",
            status: "open",
            priority: "normal",
          },
        }),
      ),
      update,
      createViewSource,
    } as unknown as MdbaseConnection<JsonObject>;
    const repository = new MdbasePlannerRepository(connection);

    const collection = await repository.load();
    const contract = { id: "tasknotes.task", version: "0.3.0-rc.3" };
    expect(connection.queryAll).toHaveBeenCalledWith(
      expect.objectContaining({ contract }),
      { firstPageSize: 500, pageSize: 1_000 },
    );
    expect(collection.statuses).toMatchObject([
      { value: "open", label: "Open", isCompleted: false },
      { value: "done", label: "Done", isCompleted: true },
    ]);
    const completed = await repository.toggleCompletion(collection.tasks[0]);
    expect(completed).toMatchObject({ status: "done", completed: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({
          status: "done",
          completedDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      }),
    );
    const regrouped = await repository.updateProperties(collection.tasks[0], {
      projects: ["[[Launch]]"],
    });
    expect(regrouped.projects).toEqual(["[[Launch]]"]);
    expect(update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        patch: expect.objectContaining({ projects: ["[[Launch]]"] }),
      }),
    );
    const schedule = { scheduled: "2026-09-09", due: "2026-09-12" };
    expect(
      await repository.updateSchedule(collection.tasks[0], schedule),
    ).toMatchObject(schedule);
    expect(connection.read).toHaveBeenLastCalledWith({
      path: "tasks/plan.md",
      contract: { ...contract, type: "task" },
    });
    expect(update).toHaveBeenLastCalledWith({
      path: "tasks/plan.md",
      contract: { ...contract, type: "task" },
      ifRevision: "task-1",
      patch: schedule,
    });
    await repository.saveView({
      name: "High work",
      status: "open",
      priority: "high",
      project: "[[Launch]]",
      showCompleted: false,
      zoom: 4,
    });

    const input = createViewSource.mock.calls[0][0];
    const document = parse(input.document) as {
      views: Array<Record<string, unknown>>;
    };
    expect(document.views[0]).toMatchObject({
      type: "tasknotesPlanner",
      name: "High work",
      options: {
        zoom: 4,
        project: "[[Launch]]",
        status: "open",
        priority: "high",
        showCompleted: false,
      },
    });
    expect(JSON.stringify(document.views[0].filters)).toContain(
      'note[\\"status\\"] == \\"open\\"',
    );
  });

  it("updates a saved Base with its revision and preserves other views and options", async () => {
    const path = "TaskNotes/Views/work.base";
    const readViewSource = vi.fn(async () =>
      success({
        path,
        revision: "view-3",
        document: JSON.stringify({
          formulas: { effort: "1 + 1" },
          views: [
            { type: "table", name: "Other" },
            {
              type: "tasknotesPlanner",
              name: "Work",
              options: { custom: "preserved", zoom: 2 },
            },
          ],
        }),
      }),
    );
    const updateViewSource = vi.fn(async (input: { document: string }) =>
      success({ path, format: "obsidian.base", revision: "view-4", ...input }),
    );
    const createViewSource = vi.fn();
    const repository = new MdbasePlannerRepository({
      readViewSource,
      updateViewSource,
      createViewSource,
    } as unknown as MdbaseConnection<JsonObject>);
    const saved = await repository.saveView({
      name: "Work",
      zoom: 4,
      view: {
        key: `${path}#work`,
        path,
        id: "work",
        name: "Work",
        format: "obsidian.base",
        revision: "view-1",
        writable: true,
        options: {},
      },
    });
    expect(readViewSource).toHaveBeenCalledWith({ path });
    expect(updateViewSource).toHaveBeenCalledWith({
      path,
      ifRevision: "view-3",
      document: expect.any(String),
    });
    expect(parse(updateViewSource.mock.calls[0][0].document)).toMatchObject({
      formulas: { effort: "1 + 1" },
      views: [
        { type: "table", name: "Other" },
        { type: "tasknotesPlanner", options: { custom: "preserved", zoom: 4 } },
      ],
    });
    expect(saved.revision).toBe("view-4");
    expect(createViewSource).not.toHaveBeenCalled();
  });

  it("recovers the persisted mutation handle without replaying a write", async () => {
    const recover = vi.fn(async () => success({ revision: "task-2" }));
    const pending = {
      requestId: "request-1",
      operation: "update",
      fingerprint: "sha256:fingerprint",
      status: "outcome_unknown",
      createdAt: "2026-08-23T12:00:00.000Z",
      recover,
    } as const;
    const update = vi.fn();
    const connection = {
      pendingMutations: vi.fn(() => [pending]),
      pendingMutation: vi.fn(() => pending),
      update,
    } as unknown as MdbaseConnection<JsonObject>;
    const repository = new MdbasePlannerRepository(connection);

    expect(repository.pendingMutations()).toEqual([
      {
        requestId: "request-1",
        operation: "update",
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    ]);

    await repository.recoverPendingMutation("request-1");

    expect(recover).toHaveBeenCalledWith({ timeoutMs: 30_000 });
    expect(update).not.toHaveBeenCalled();
  });
});

function success<Value>(value: Value) {
  return { ok: true as const, value, diagnostics: [] };
}
