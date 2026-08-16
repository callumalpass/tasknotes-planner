import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
});

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
