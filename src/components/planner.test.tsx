import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MdbaseConnectError, type ConnectProblem } from "@mdbase-dev/connect";

import { Planner } from "./planner";

import type {
  PendingPlannerMutation,
  PlannerCollection,
  PlannerRepository,
  PlannerTask,
  ScheduleUpdate,
} from "../domain/task";

vi.mock("./gantt-chart", () => ({
  GanttChart: ({
    tasks,
    mutationsDisabled,
    onCompletionChange,
    onDependenciesChange,
    onScheduleChange,
    onSelect,
  }: {
    tasks: readonly PlannerTask[];
    mutationsDisabled?: boolean;
    onCompletionChange(task: PlannerTask): Promise<void>;
    onDependenciesChange(
      task: PlannerTask,
      dependencies: PlannerTask["blockedBy"],
    ): Promise<void>;
    onScheduleChange(task: PlannerTask, update: ScheduleUpdate): Promise<void>;
    onSelect(task: PlannerTask): void;
  }) => (
    <div>
      <output data-testid="scheduled-value">{tasks[0]?.scheduled}</output>
      {tasks[0] ? (
        <>
          <button type="button" onClick={() => onSelect(tasks[0])}>
            Select test task
          </button>
          <button
            disabled={mutationsDisabled}
            type="button"
            onClick={() =>
              void onScheduleChange(tasks[0], {
                scheduled: "2026-08-24",
              }).catch(() => undefined)
            }
          >
            Move test task
          </button>
          <button
            disabled={mutationsDisabled}
            type="button"
            onClick={() =>
              void onDependenciesChange(tasks[0], []).catch(() => undefined)
            }
          >
            Change test dependencies
          </button>
          <button
            disabled={mutationsDisabled}
            type="button"
            onClick={() =>
              void onCompletionChange(tasks[0]).catch(() => undefined)
            }
          >
            Complete test task
          </button>
        </>
      ) : null}
    </div>
  ),
}));

const collection: PlannerCollection = {
  id: "collection-1",
  name: "Work",
  tasks: [],
  views: [],
  statuses: [],
  priorities: [],
};

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  HTMLElement.prototype.scrollTo = vi.fn();
});

describe("Planner connection recovery", () => {
  it("surfaces clearSelection failures while the collection remains ready", async () => {
    const repository = repositoryFixture();
    const onChangeCollection = vi.fn(() => {
      throw new Error("The session is no longer available.");
    });
    render(
      <Planner
        repository={repository}
        onChangeCollection={onChangeCollection}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Work/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The session is no longer available.",
    );
  });

  it("recovers a durable pending handle explicitly and reconciles by loading", async () => {
    let completeRecovery = () => undefined;
    let pending: readonly PendingPlannerMutation[] = [
      {
        requestId: "request-1",
        operation: "update",
        createdAt: "2026-08-23T12:00:00.000Z",
      },
    ];
    const repository = repositoryFixture({
      pendingMutations: () => pending,
      recoverPendingMutation: vi.fn(() => {
        return new Promise<void>((resolve) => {
          completeRecovery = () => {
            pending = [];
            resolve();
          };
        });
      }),
    });
    render(
      <Planner repository={repository} onChangeCollection={() => undefined} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Recover pending change" }),
    );

    await waitFor(() =>
      expect(repository.recoverPendingMutation).toHaveBeenCalledWith(
        "request-1",
      ),
    );
    expect(screen.getByRole("button", { name: "Recovering…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save view" })).toBeDisabled();

    completeRecovery();
    await waitFor(() => expect(repository.load).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByRole("button", { name: "Recover pending change" }),
    ).not.toBeInTheDocument();
  });

  it("reconciles a consumed recovery rejection before releasing writes", async () => {
    let pending: readonly PendingPlannerMutation[] = [pendingMutation()];
    let finishReload: () => void = () => undefined;
    let loads = 0;
    const load = vi.fn(() => {
      loads += 1;
      if (loads === 1) return Promise.resolve(structuredClone(collection));
      return new Promise<PlannerCollection>((resolve) => {
        finishReload = () => resolve(structuredClone(collection));
      });
    });
    const repository = repositoryFixture({
      load,
      pendingMutations: () => pending,
      recoverPendingMutation: vi.fn(async () => {
        pending = [];
        throw new Error("The original update was rejected.");
      }),
    });
    render(
      <Planner repository={repository} onChangeCollection={() => undefined} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Recover pending change" }),
    );

    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Recovering…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save view" })).toBeDisabled();

    finishReload();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Recover pending change" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Save view" })).toBeEnabled();
  });

  it("retains the write gate without reloading when recovery remains retryable", async () => {
    const pending = pendingMutation();
    const repository = repositoryFixture({
      pendingMutations: () => [pending],
      recoverPendingMutation: vi.fn(async () => {
        throw new Error("The connector is temporarily unavailable.");
      }),
    });
    render(
      <Planner repository={repository} onChangeCollection={() => undefined} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Recover pending change" }),
    );

    await waitFor(() =>
      expect(repository.recoverPendingMutation).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Recover pending change" }),
      ).toBeEnabled(),
    );
    expect(repository.load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save view" })).toBeDisabled();
  });

  it("keeps an uncertain optimistic schedule until explicit recovery", async () => {
    const task = plannerTask();
    let pending: readonly PendingPlannerMutation[] = [];
    const problem = {
      problem_version: 1,
      code: "operation_outcome_unknown",
      category: "transport",
      recovery: "recover_mutation",
      message: "The schedule may already have changed.",
      operation_outcome: "unknown",
    } as unknown as ConnectProblem;
    const updateSchedule = vi.fn(async () => {
      pending = [
        {
          requestId: "request-1",
          operation: "update",
          createdAt: "2026-08-23T12:00:00.000Z",
        },
      ];
      throw new MdbaseConnectError(problem);
    });
    const repository = repositoryFixture({
      load: vi.fn(async () => ({
        ...structuredClone(collection),
        tasks: [task],
      })),
      updateSchedule,
      pendingMutations: () => pending,
      recoverPendingMutation: vi.fn(),
    });
    render(
      <Planner repository={repository} onChangeCollection={() => undefined} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Move test task" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("scheduled-value")).toHaveTextContent(
        "2026-08-24",
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Recover pending change" }),
    ).toBeInTheDocument();
    expect(updateSchedule).toHaveBeenCalledTimes(1);
  });

  it("blocks every subsequent write while a mutation awaits recovery", async () => {
    const task = plannerTask();
    const repository = repositoryFixture({
      load: vi.fn(async () => ({
        ...structuredClone(collection),
        tasks: [task],
      })),
      pendingMutations: () => [
        {
          requestId: "request-1",
          operation: "update",
          createdAt: "2026-08-23T12:00:00.000Z",
        },
      ],
      recoverPendingMutation: vi.fn(),
    });
    render(
      <Planner repository={repository} onChangeCollection={() => undefined} />,
    );

    const ganttWrites = [
      await screen.findByRole("button", { name: "Move test task" }),
      screen.getByRole("button", { name: "Change test dependencies" }),
      screen.getByRole("button", { name: "Complete test task" }),
    ];
    for (const button of ganttWrites) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }

    expect(
      screen.getByRole("button", { name: "Recover pending change" }),
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save view" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Select test task" }));
    expect(
      document.querySelector<HTMLSelectElement>(
        ".task-inspector .planning-field select",
      ),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save schedule" }),
    ).toBeDisabled();

    expect(repository.updateSchedule).not.toHaveBeenCalled();
    expect(repository.updateDependencies).not.toHaveBeenCalled();
    expect(repository.updateProperties).not.toHaveBeenCalled();
    expect(repository.toggleCompletion).not.toHaveBeenCalled();
    expect(repository.saveView).not.toHaveBeenCalled();
  });
});

function repositoryFixture(
  overrides: Partial<PlannerRepository> = {},
): PlannerRepository {
  return {
    load: vi.fn(async () => structuredClone(collection)),
    updateSchedule: vi.fn(),
    updateDependencies: vi.fn(),
    updateProperties: vi.fn(),
    toggleCompletion: vi.fn(),
    saveView: vi.fn(),
    pendingMutations: () => [],
    ...overrides,
  };
}

function plannerTask(): PlannerTask {
  return {
    id: "task-1",
    path: "tasks/task-1.md",
    title: "Plan release",
    status: "open",
    priority: "normal",
    scheduled: "2026-08-23",
    due: "2026-08-25",
    projects: [],
    blockedBy: [{ uid: "research", reltype: "FINISHTOSTART" }],
    completed: false,
    statusLabel: "Open",
    statusColor: "#64748b",
    priorityLabel: "Normal",
    priorityColor: "#64748b",
    statusOptions: [
      {
        value: "open",
        label: "Open",
        color: "#64748b",
        order: 1,
        isCompleted: false,
        isSkipped: false,
      },
    ],
    priorityOptions: [
      { value: "normal", label: "Normal", color: "#64748b", weight: 1 },
    ],
  };
}

function pendingMutation(): PendingPlannerMutation {
  return {
    requestId: "request-1",
    operation: "update",
    createdAt: "2026-08-23T12:00:00.000Z",
  };
}
