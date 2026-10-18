import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DemoPlannerRepository } from "../data/demo-repository";
import type { PlannerCollection } from "../domain/task";
import { Planner } from "./planner";

const collectionId = "22222222-2222-4222-8222-222222222222";
const originalHref = location.href;

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  HTMLElement.prototype.scrollTo = vi.fn();
  vi.stubEnv("VITE_MDBASE_ENV", "");
  vi.stubEnv("VITE_MDBASE_CONNECT_URL", "");
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  history.replaceState(null, "", originalHref);
});

async function showCollection(patch: Partial<PlannerCollection> = {}) {
  const repository = new DemoPlannerRepository();
  const collection = {
    ...(await repository.load()),
    id: collectionId,
    name: "My planning collection",
    ...patch,
  };
  vi.spyOn(repository, "load").mockResolvedValue(collection);
  render(<Planner repository={repository} onChangeCollection={vi.fn()} />);
  await screen.findByRole("button", { name: /My planning collection/ });
  return { repository, collection };
}

describe("Planner empty states", () => {
  it.each([
    [
      "lab",
      "https://connect-lab.mdbase.dev",
      "https://lab.tasknotes-app.pages.dev",
    ],
    [
      "",
      "https://connect-staging.mdbase.dev",
      "https://staging.tasknotes-app.pages.dev",
    ],
    ["", "", "https://app.tasknotes.dev"],
  ])(
    "hands an empty collection to TaskNotes in its deployment (%s, %s)",
    async (environment, connectUrl, origin) => {
      vi.stubEnv("VITE_MDBASE_ENV", environment);
      vi.stubEnv("VITE_MDBASE_CONNECT_URL", connectUrl);
      history.replaceState(
        null,
        "",
        "/?collection=11111111-1111-4111-8111-111111111111&demo=1&code=not-forwarded&server=https://wrong.example/#private",
      );
      await showCollection({ tasks: [] });
      expect(
        screen.getByRole("heading", { name: "No tasks yet" }),
      ).toBeVisible();
      expect(
        screen.getByText(
          /Add your first task here, or create tasks in TaskNotes/,
        ),
      ).toBeVisible();
      const link = screen.getByRole("link", {
        name: /Create tasks in TaskNotes/,
      });
      const destination = new URL(link.getAttribute("href")!);
      expect(destination.origin).toBe(origin);
      expect([...destination.searchParams]).toEqual([
        ["collection", collectionId],
      ]);
      expect(destination.hash).toBe("");
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel")?.split(" ")).toContain("noopener");
      expect(screen.queryByText("No tasks match these controls")).toBeNull();
      expect(screen.getByRole("button", { name: "Add task" })).toBeEnabled();
    },
  );

  it("keeps search-filtered tasks distinct from a collection with no tasks", async () => {
    await showCollection();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search tasks" }), {
      target: { value: "nothing matches this phrase" },
    });
    expect(
      screen.getByRole("heading", { name: "No tasks match these controls" }),
    ).toBeVisible();
    expect(screen.queryByText("No tasks yet")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Create tasks in TaskNotes/ }),
    ).toBeNull();
  });

  it("keeps completed-only tasks distinct and lets the completed filter reveal them", async () => {
    const sample = await new DemoPlannerRepository().load();
    await showCollection({ tasks: [{ ...sample.tasks[0], completed: true }] });
    expect(
      screen.getByRole("heading", { name: "No tasks match these controls" }),
    ).toBeVisible();
    expect(screen.queryByText("No tasks yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getAllByText(sample.tasks[0].title).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("No tasks match these controls")).toBeNull();
  });

  it("does not claim the collection is empty when a saved view returns no tasks", async () => {
    const view = {
      key: "TaskNotes/Views/empty.base#empty",
      path: "TaskNotes/Views/empty.base",
      id: "empty",
      name: "Empty saved view",
      format: "obsidian.base",
      revision: "revision",
      writable: true,
      options: {},
    };
    await showCollection({ tasks: [], views: [view], activeView: view });
    expect(
      screen.getByRole("heading", { name: "No tasks match these controls" }),
    ).toBeVisible();
    expect(
      screen.getByText("Change the saved view, search, or task filters."),
    ).toBeVisible();
    expect(screen.queryByText("No tasks yet")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Create tasks in TaskNotes/ }),
    ).toBeNull();
  });

  it("does not call a failed task load an empty collection", async () => {
    const repository = new DemoPlannerRepository();
    vi.spyOn(repository, "load").mockRejectedValue(
      new Error("Task index unavailable"),
    );
    render(<Planner repository={repository} onChangeCollection={vi.fn()} />);
    expect(
      await screen.findByRole("heading", {
        name: "This collection could not be opened",
      }),
    ).toBeVisible();
    expect(screen.queryByText("No tasks yet")).toBeNull();
    expect(
      screen.queryByRole("link", { name: /Create tasks in TaskNotes/ }),
    ).toBeNull();
  });
});
