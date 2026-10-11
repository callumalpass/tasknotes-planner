import { connect, toValue, type wire } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model";
import { vi } from "vitest";

/** Actual public SDK codec/client over its testing replica. Catalog and native
 * Bases discovery are explicit stand-ins, never native/readiness qualification.
 * The caller owns and closes this test client; borrowed views must not close it. */
export async function nativePlannerFixture(title = "Plan the SDK port") {
  const replica = new MemoryReplica({ confirmDelayMs: 0 });
  const record = replica.seed({
    path: "tasks/launch.md",
    types: ["task"],
    frontmatter: { id: "launch-task", title, status: "open" },
    body: "Not needed to render the planning ledger.",
  });
  const client = await connect({
    connector: replica.connector(),
    app: { name: "planner-ui-test", version: "test" },
    reconnect: false,
  });
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
        implementedBy: ["task"],
      },
    ],
    types: [
      {
        name: "task",
        path: "_types/task.md",
        implements: [
          {
            contract: "tasknotes.task",
            version: TASKNOTES_SPEC_VERSION,
            fields: new Map(
              Object.entries({
                id: "id",
                title: "title",
                status: "status",
                priority: "priority",
                projects: "projects",
                scheduled: "scheduled",
                due: "due",
                blockedBy: "blockedBy",
                completedDate: "completedDate",
              }),
            ),
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
  vi.spyOn(client, "describe").mockResolvedValue(catalog);
  vi.spyOn(client, "listAppBasesViews").mockResolvedValue({
    kind: "success",
    views: [],
    continuation: null,
    clock: {
      instant: Date.UTC(2026, 9, 11),
      tz: "UTC",
      localDate: "2026-10-11",
    },
    collectionRevision: "b".repeat(64),
  });
  return { replica, client, record, catalog };
}
