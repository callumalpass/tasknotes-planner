import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connect,
  toValue,
  type MdbaseClient,
  type wire,
} from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { TASKNOTES_CONTRACT_DIGEST } from "@tasknotes/model/mdbase";
import { TASKNOTES_SPEC_VERSION } from "@tasknotes/model";
import { NextPlannerRepository } from "../data/next-planner-repository";
import type { NextPlannerViewAccess } from "../data/next-planner-views";
import { Planner } from "./planner";

const clients: MdbaseClient[] = [];
const repositories: NextPlannerRepository[] = [];
const originalScrollTo = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollTo",
);
beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  for (const repository of repositories.splice(0)) repository.dispose();
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalScrollTo)
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

async function nativeFixture() {
  const replica = new MemoryReplica({ confirmDelayMs: 0 });
  replica.seed({
    path: "tasks/launch.md",
    types: ["task"],
    frontmatter: {
      id: "launch-task",
      title: "Plan the SDK port",
      status: "open",
    },
    body: "Not needed to render the planning ledger.",
  });
  const client = await connect({
    connector: replica.connector(),
    app: { name: "planner-ui-test", version: "test" },
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
              Object.entries({ id: "id", title: "title", status: "status" }),
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
                ],
              },
            }),
          },
        ],
      },
    ],
  };
  // Real SDK client/codec over MemoryReplica; catalog and native Bases are stand-ins.
  vi.spyOn(client, "describe").mockResolvedValue(catalog);
  const views: NextPlannerViewAccess = {
    list: vi.fn(async () => []),
    execute: vi.fn(async () => []),
    save: vi.fn(),
  };
  const repository = new NextPlannerRepository(
    client,
    "Native test collection",
    views,
  );
  repositories.push(repository);
  return { client, repository, catalog };
}

describe("Planner native client surface (SDK testing fake, not native acceptance)", () => {
  it("renders the native repository in the existing ledger without a legacy session", async () => {
    const { client, repository } = await nativeFixture();
    const get = vi.spyOn(client, "get");
    const close = vi.spyOn(client, "close");
    const changeCollection = vi.fn();
    const view = render(
      <Planner repository={repository} onChangeCollection={changeCollection} />,
    );
    await waitFor(() =>
      expect(screen.getAllByText("Plan the SDK port").length).toBeGreaterThan(
        0,
      ),
    );
    expect(
      screen.getByRole("button", { name: /Native test collection/ }),
    ).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    view.unmount();
    repository.dispose();
    expect(close).not.toHaveBeenCalled();
  });

  it("shows an exact-contract refusal instead of an empty or ready planning ledger", async () => {
    const { client, repository, catalog } = await nativeFixture();
    vi.mocked(client.describe).mockResolvedValue({ ...catalog, contracts: [] });
    render(<Planner repository={repository} onChangeCollection={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText(/does not provide tasknotes.task/)).toBeTruthy(),
    );
    expect(screen.queryByText("Plan the SDK port")).toBeNull();
  });
});
