import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
});

test("zooms and toggles TaskNotes completion", async ({ page }) => {
  await expect(page.locator(".zoom-control output")).toHaveText("Weeks");
  await page.getByRole("button", { name: "Zoom in" }).click();
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
