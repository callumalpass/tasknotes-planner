import { DemoPlannerRepository } from "./demo-repository";

describe("DemoPlannerRepository", () => {
  it("applies TaskNotes state definitions and saves Planner views", async () => {
    const repository = new DemoPlannerRepository("2026-08-16");
    const collection = await repository.load();
    expect(collection.statuses.map(({ value }) => value)).toContain(
      "in-progress",
    );

    const task = collection.tasks.find(({ id }) => id === "prototype")!;
    const updated = await repository.updateProperties(task, {
      status: "in-progress",
      priority: "low",
    });
    expect(updated).toMatchObject({
      status: "in-progress",
      statusLabel: "In progress",
      priority: "low",
      priorityLabel: "Low",
    });

    const completed = await repository.toggleCompletion(updated);
    expect(completed).toMatchObject({
      status: "done",
      statusLabel: "Done",
      completed: true,
    });
    const reopened = await repository.toggleCompletion(completed);
    expect(reopened).toMatchObject({ status: "open", completed: false });
    const regrouped = await repository.updateProperties(reopened, {
      projects: ["[[Launch]]", "[[Operations]]"],
    });
    expect(regrouped.projects).toEqual(["[[Launch]]", "[[Operations]]"]);

    const view = await repository.saveView({
      name: "Launch sequence",
      zoom: 4,
      project: "[[Launch]]",
      status: "in-progress",
      priority: "low",
      showCompleted: false,
    });
    expect((await repository.load(view.key)).activeView).toMatchObject({
      name: "Launch sequence",
      options: {
        zoom: 4,
        project: "[[Launch]]",
        status: "in-progress",
        priority: "low",
        showCompleted: false,
      },
    });
  });
});
