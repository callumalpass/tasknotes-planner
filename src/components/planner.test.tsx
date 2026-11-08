import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MdbaseError } from "@mdbase-dev/sdk";

import { Planner } from "./planner";

import type {
  PlannerCollection,
  PlannerRepository,
  PlannerTask,
  ScheduleUpdate,
} from "../domain/task";

vi.mock("./gantt-chart", () => ({
  GanttChart: ({
    tasks,
    onCompletionChange,
    onDependenciesChange,
    onScheduleChange,
    onSelect,
  }: {
    tasks: readonly PlannerTask[];
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
            type="button"
            onClick={() =>
              void onDependenciesChange(tasks[0], []).catch(() => undefined)
            }
          >
            Change test dependencies
          </button>
          <button
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

  it("surfaces asynchronous SDK clearSelection refusal without dropping the current ledger", async () => {
    const repository = repositoryFixture();
    const onChangeCollection = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error("The original collection could not close."));
    render(
      <Planner
        repository={repository}
        onChangeCollection={onChangeCollection}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Work/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The original collection could not close.",
    );
    expect(screen.getByRole("button", { name: /Work/ })).toBeTruthy();
    expect(onChangeCollection).toHaveBeenCalledOnce();
  });

  it("keeps an uncertain optimistic schedule", async () => {
    const task = plannerTask();
    const updateSchedule = vi.fn(async () => {
      throw new MdbaseError({
        code: "outcome_unknown",
        recovery: "refresh",
        message: "The schedule may already have changed.",
      });
    });
    const repository = repositoryFixture({
      load: vi.fn(async () => ({
        ...structuredClone(collection),
        tasks: [task],
      })),
      updateSchedule,
    });
    render(
      <Planner repository={repository} onChangeCollection={() => undefined} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Move test task" }),
    );

    await waitFor(() => expect(updateSchedule).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("scheduled-value")).toHaveTextContent(
        "2026-08-24",
      ),
    );
  });
});

describe("Planner save view dialog", () => {
  it("keeps Tab inside the dialog and returns focus to the opener on Escape", async () => {
    render(
      <Planner
        repository={repositoryFixture()}
        onChangeCollection={() => undefined}
      />,
    );
    const opener = await screen.findByRole("button", { name: "Save view" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Create Planner view" });
    expect(screen.getByRole("textbox", { name: "View name" })).toHaveFocus();
    const close = within(dialog).getByRole("button", { name: "Close" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });

    cancel.focus();
    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});

describe("Planner save as new view", () => {
  it("retries a renamed save under the same intent", async () => {
    const saveView = vi
      .fn()
      .mockRejectedValueOnce(new Error("reply lost"))
      .mockReturnValue(new Promise(() => undefined));
    render(
      <Planner
        repository={repositoryFixture({ saveView })}
        onChangeCollection={() => undefined}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Save view" }));
    const dialog = screen.getByRole("dialog", { name: "Create Planner view" });
    const name = screen.getByRole("textbox", { name: "View name" });
    fireEvent.change(name, { target: { value: "First" } });
    fireEvent.submit(name.closest("form")!);
    await within(dialog).findByRole("alert");
    fireEvent.change(name, { target: { value: "Renamed" } });
    fireEvent.submit(name.closest("form")!);
    await waitFor(() => expect(saveView).toHaveBeenCalledTimes(2));
    const [[first], [retry]] = saveView.mock.calls as [
      [{ intent: string }],
      [{ intent: string; name: string }],
    ];
    expect(retry).toMatchObject({ name: "Renamed", intent: first.intent });
  });
});

function repositoryFixture(
  overrides: Partial<PlannerRepository> = {},
): PlannerRepository {
  return {
    load: vi.fn(async () => structuredClone(collection)),
    createTask: vi.fn(),
    updateSchedule: vi.fn(),
    updateDependencies: vi.fn(),
    updateProperties: vi.fn(),
    toggleCompletion: vi.fn(),
    saveView: vi.fn(),
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
