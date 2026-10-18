import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { MdbaseError } from "@mdbase-dev/sdk";
import { DemoPlannerRepository } from "../data/demo-repository";
import { Planner } from "./planner";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  HTMLElement.prototype.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function setup(empty = true) {
  const repository = new DemoPlannerRepository();
  const collection = await repository.load();
  const created = {
    ...collection.tasks[0],
    id: crypto.randomUUID(),
    title: "First shared task",
  };
  const load = vi
    .spyOn(repository, "load")
    .mockResolvedValue({ ...collection, tasks: empty ? [] : collection.tasks });
  repository.createTask = vi.fn(async () => {
    load.mockResolvedValue({ ...collection, tasks: [created] });
    return created;
  });
  render(<Planner repository={repository} onChangeCollection={vi.fn()} />);
  await screen.findByRole("button", { name: /Sample tasks/ });
  return { repository, created };
}

describe("Planner task creation", () => {
  it("offers an empty-state action and a persistent add control, then shows the created task", async () => {
    const { repository } = await setup();
    expect(screen.getByRole("button", { name: "Add task" })).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Add your first task" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Add task" });
    const title = within(dialog).getByRole("textbox", { name: "Task title" });
    expect(title).toHaveFocus();
    expect(
      within(dialog).getByRole("button", { name: "Add task" }),
    ).toBeDisabled();
    fireEvent.change(title, { target: { value: "First shared task" } });
    fireEvent.submit(
      within(dialog).getByRole("button", { name: "Add task" }).closest("form")!,
    );
    await waitFor(() =>
      expect(repository.createTask).toHaveBeenCalledWith(
        "First shared task",
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add task" })).toBeNull(),
    );
    expect(screen.queryByText("No tasks yet")).toBeNull();
    expect(screen.getAllByText("First shared task").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add task" })).toBeEnabled();
  });

  it("keeps add available with existing tasks and preserves a refused draft without reporting success", async () => {
    const { repository } = await setup(false);
    vi.mocked(repository.createTask).mockRejectedValueOnce(
      new Error("The collection refused this task."),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog", { name: "Add task" });
    const title = within(dialog).getByRole("textbox", { name: "Task title" });
    fireEvent.change(title, { target: { value: "Keep this draft" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The collection refused this task.",
    );
    expect(title).toHaveValue("Keep this draft");
    expect(screen.getByRole("dialog", { name: "Add task" })).toBeVisible();
    expect(screen.queryByText("Task added")).toBeNull();
  });

  it("retains the original title and creation identity after an unknown outcome and reopening", async () => {
    const { repository } = await setup();
    vi.mocked(repository.createTask).mockRejectedValueOnce(
      new MdbaseError({
        code: "outcome_unknown",
        recovery: "refresh",
        message: "The result is unknown",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    let dialog = screen.getByRole("dialog", { name: "Add task" });
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Task title" }),
      { target: { value: "Original task" } },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Add task" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      /same task creation/,
    );
    const intent = vi.mocked(repository.createTask).mock.calls[0][1];
    expect(
      within(dialog).getByRole("textbox", { name: "Task title" }),
    ).toHaveAttribute("readonly");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    dialog = screen.getByRole("dialog", { name: "Add task" });
    expect(
      within(dialog).getByRole("textbox", { name: "Task title" }),
    ).toHaveValue("Original task");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add task" }));
    await waitFor(() =>
      expect(repository.createTask).toHaveBeenLastCalledWith(
        "Original task",
        intent,
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add task" })).toBeNull(),
    );
  });

  it("does not send a second creation or allow cancellation while the first is in flight", async () => {
    const { repository, created } = await setup();
    let complete!: (value: typeof created) => void;
    vi.mocked(repository.createTask).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    const dialog = screen.getByRole("dialog", { name: "Add task" });
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Task title" }),
      { target: { value: "Only once" } },
    );
    const form = within(dialog)
      .getByRole("button", { name: "Add task" })
      .closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(repository.createTask).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getByRole("button", { name: "Cancel" }),
    ).toBeDisabled();
    complete(created);
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Add task" })).toBeNull(),
    );
  });
});
