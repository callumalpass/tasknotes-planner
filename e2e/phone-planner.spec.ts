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

test("schedule dates and times have full-width rows on phones", async ({
  page,
}) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?demo=1");
    await page
      .getByRole("button", { name: /Select to edit or drag/ })
      .first()
      .click();
    const inspector = page.locator(".task-inspector");
    for (const field of ["Scheduled", "Due"]) {
      const date = inspector.getByLabel(field, { exact: true });
      const time = inspector.getByLabel(`${field} time`, { exact: true });
      await date.fill("2026-11-07");
      const dateBounds = await date.boundingBox();
      const timeBounds = await time.boundingBox();
      expect(dateBounds).not.toBeNull();
      expect(timeBounds).not.toBeNull();
      expect(dateBounds!.width).toBeGreaterThanOrEqual(240);
      expect(timeBounds!.width).toBeGreaterThanOrEqual(240);
      expect(timeBounds!.y).toBeGreaterThanOrEqual(
        dateBounds!.y + dateBounds!.height,
      );
      expect(dateBounds!.x + dateBounds!.width).toBeLessThanOrEqual(width);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});

test("an unscheduled title can drop onto the timeline and still opens the editor on click", async ({
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
  const corner = await page.locator(".tnc-tl-corner").boundingBox();
  if (!source || !corner) throw new Error("Drag geometry unavailable");
  await page.mouse.move(
    source.x + source.width / 2,
    source.y + source.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    corner.x + corner.width + 200,
    source.y + source.height / 2,
    { steps: 12 },
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

const phonePrefix = "[test] bugfix3 same-prefix phone task";

for (const width of [320, 390]) {
  test(`same-prefix titles remain distinguishable with aligned rows at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/e2e/fixtures/phone-ledger.html");
    await page.getByLabel(/^Search tasks/).fill(phonePrefix);
    const rows = page.locator(".tnc-tl-row:not(.is-group)");
    await expect(rows).toHaveCount(2);
    await page.evaluate(() => document.fonts.ready);
    for (const suffix of ["alpha", "beta"]) {
      const title = page
        .locator(".ledger-title strong")
        .filter({ hasText: `${phonePrefix} ${suffix}` });
      await expect(title).toHaveCSS("white-space", "normal");
      expect(
        await title.evaluate((element, suffix) => {
          const text = element.firstChild;
          const start = element.textContent!.lastIndexOf(suffix);
          if (!text || start < 0) throw new Error("Title suffix is missing");
          const range = document.createRange();
          range.setStart(text, start);
          range.setEnd(text, start + suffix.length);
          const glyphs = range.getBoundingClientRect();
          const bounds = element.getBoundingClientRect();
          return (
            glyphs.top >= bounds.top - 1 &&
            glyphs.bottom <= bounds.bottom + 1 &&
            glyphs.left >= bounds.left - 1 &&
            glyphs.right <= bounds.right + 1
          );
        }, suffix),
      ).toBe(true);
    }
    for (const row of await rows.all()) {
      const bounds = (await row.boundingBox())!;
      expect(bounds.height).toBe(65);
      const ledger = (await row.locator(".task-ledger").boundingBox())!;
      const track = (await row.locator(".tnc-tl-track").boundingBox())!;
      expect(ledger.y).toBe(track.y);
      expect(ledger.height).toBe(track.height);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  });
}

test("row completion and reopening refresh the inspector without discarding a date draft", async ({
  page,
}) => {
  await page.goto("/e2e/fixtures/phone-ledger.html");
  await page.getByLabel(/^Search tasks/).fill(phonePrefix);
  await page.getByRole("button", { name: "Completed", exact: true }).click();
  const title = `${phonePrefix} alpha`;
  await page.locator(".task-ledger-main").filter({ hasText: title }).click();
  const inspector = page.locator(".task-inspector");
  await inspector.getByLabel("Scheduled", { exact: true }).fill("2026-11-07");
  await page
    .getByRole("button", { name: `Complete ${title}`, exact: true })
    .click();
  await expect(inspector.getByLabel(/^Status/)).toHaveValue("done");
  await expect(inspector.locator(".inspector-title p")).toContainText("Done");
  await expect(inspector.getByLabel("Scheduled", { exact: true })).toHaveValue(
    "2026-11-07",
  );
  await page
    .getByRole("button", { name: `Reopen ${title}`, exact: true })
    .click();
  await expect(inspector.getByLabel(/^Status/)).toHaveValue("open");
  await expect(inspector.locator(".inspector-title p")).toContainText("Open");
  await expect(inspector.getByLabel("Scheduled", { exact: true })).toHaveValue(
    "2026-11-07",
  );
});
