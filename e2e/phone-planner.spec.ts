import { expect, test } from "@playwright/test";

// These checks use only the in-memory sample collection, never a real account.
test.beforeEach(async ({ context, baseURL }) => {
  if (!baseURL) throw new Error("A loopback application URL is required");
  const app = new URL(baseURL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(app.hostname)) {
    throw new Error("Sample checks must run against a loopback application");
  }
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === app.origin
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
  await context.routeWebSocket("**/*", (socket) => {
    if (new URL(socket.url()).host === app.host) socket.connectToServer();
    else socket.close();
  });
});

for (const width of [320, 390]) {
  test(`Save view stays available at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?demo=1");
    await expect(page.locator(".gantt-scroll")).toBeVisible();
    const save = page.getByRole("button", { name: "Save view", exact: true });
    await expect(save).toBeVisible();
    const bounds = await save.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await save.click();
    const dialog = page.getByRole("dialog", { name: "Create Planner view" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("View name").fill("[test] Phone plan");
    await dialog
      .getByRole("button", { name: "Save view", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page
        .getByRole("combobox", { name: "Planner view" })
        .locator("option:checked"),
    ).toHaveText("[test] Phone plan");
    await expect(
      page.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeVisible();
  });
}

test("an unscheduled title can drop onto a date header and still opens the editor on click", async ({
  page,
}) => {
  await page.goto("/?demo=1");
  const title = page
    .getByRole("button", { name: /not scheduled. Select to edit or drag/ })
    .first();
  await expect(title).toBeVisible();
  const name = await title.locator("strong").innerText();
  const ledger = page.locator(".task-ledger-main").filter({ hasText: name });
  const source = await title.boundingBox();
  const header = await page.locator(".timeline-header").boundingBox();
  const corner = await page.locator(".gantt-corner").boundingBox();
  if (!source || !header || !corner)
    throw new Error("Drag geometry unavailable");
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    corner.x + corner.width + 200,
    header.y + header.height / 2,
    {
      steps: 12,
    },
  );
  await page.mouse.up();
  await expect(page.locator(".gantt-interaction-message")).toHaveText(
    "Schedule saved",
  );
  await expect(ledger).not.toContainText("Not scheduled");
  await expect(page.locator(".task-inspector")).toHaveCount(0);
  await ledger.click();
  await expect(page.locator(".task-inspector")).toBeVisible();
});
