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
        success({ results: [], meta: { totalCount: 0, hasMore: false } }),
      ),
      createViewSource,
    } as unknown as MdbaseConnection<JsonObject>;
    const repository = new MdbasePlannerRepository(connection);

    const collection = await repository.load();
    expect(collection.statuses).toMatchObject([
      { value: "open", label: "Open", isCompleted: false },
      { value: "done", label: "Done", isCompleted: true },
    ]);
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
});

function success<Value>(value: Value) {
  return { ok: true as const, value, diagnostics: [] };
}
