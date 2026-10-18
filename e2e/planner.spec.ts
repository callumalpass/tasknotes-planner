import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
});

for (const width of [1440, 834, 390, 360]) {
  test(`adds an ordinary task from the persistent control at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const add = page.getByRole("button", { name: "Add task", exact: true });
    await expect(add).toBeInViewport();
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Add task", exact: true });
    const title = dialog.getByRole("textbox", { name: "Task title" });
    await expect(title).toBeFocused();
    await title.fill("A task captured in Planner");
    await dialog.getByRole("button", { name: "Add task", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "A task captured in Planner" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("zooms and toggles TaskNotes completion", async ({ page }) => {
  await expect(page.locator(".zoom-control output")).toHaveText("Weeks");
  const timeline = page.locator(".gantt-scroll");
  const bounds = await timeline.boundingBox();
  if (!bounds) throw new Error("Timeline bounds are unavailable.");
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + 180);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect(page.locator(".zoom-control output")).toHaveText("Work weeks");

  await page
    .getByRole("button", { name: "Complete Define launch measures" })
    .click();
  await expect(
    page.getByRole("button", { name: "Complete Define launch measures" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reopen Define launch measures" }),
  ).toBeVisible();
});

test("edits memberships, planning group, and Unassigned", async ({ page }) => {
  await page
    .getByRole("button", { name: /Cross-platform acceptance pass.*Open/ })
    .click();
  const projects = page.getByRole("group", { name: "Projects" });
  await projects.getByRole("checkbox", { name: "Operations" }).check();
  await projects
    .getByRole("button", { name: "Use Operations as planning group" })
    .click();
  await expect(
    page.locator(".group-ledger").filter({ hasText: "Operations" }),
  ).toContainText("2");

  await projects.getByRole("button", { name: "Move to Unassigned" }).click();
  await expect(
    page.locator(".group-ledger").filter({ hasText: "Unassigned" }),
  ).toContainText("1");
});
