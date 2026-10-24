import { expect, test, type Page } from "@playwright/test";

// Opens every page and the main dialogs of Eardloom against the sample world, and fails on
// any error: an exception, an error logged to the console, or a page showing "This page
// couldn't be shown". Screenshots of each step go to test-results/smoke.

type Route = Record<string, unknown> & { view: string };

const errors: string[] = [];

async function visit(page: Page, name: string, route?: Route) {
  if (route) await page.evaluate((r) => window.__smoke.store.getState().go(r as never), route);
  await page.waitForTimeout(700);
  // The app is still there (a blank window has no errors to report, but is still broken).
  await expect(page.locator(".app"), `${name}: the window went blank`).toBeVisible();
  await expect(page.locator(".page-error"), `${name}: the page failed to draw`).toHaveCount(0);
  await page.screenshot({ path: `test-results/smoke/${name}.png` });
  expect(errors, `${name}: errors while showing the page`).toEqual([]);
}

test("every page opens without errors", async ({ page }) => {
  page.on("pageerror", (e) => errors.push(`exception: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|favicon/.test(m.text())) errors.push(`console: ${m.text()}`);
  });

  await page.goto("/");
  await expect(page.getByText("The Sample Isles")).toBeVisible();
  await visit(page, "00-home");

  await page.evaluate(async () => {
    const s = window.__smoke;
    await s.store.getState().openWorld(s.world as never);
  });
  await visit(page, "01-dashboard");
  // Writing goals: today's words, the streak and the book's deadline pace.
  await expect(page.locator(".writing-today")).toContainText("day streak");
  await expect(page.locator(".writing-today .deadlines")).toContainText("words a day");

  // The codex
  await visit(page, "02-category-table", { view: "type", typeId: "t_char" });
  await page.getByRole("button", { name: "Gallery" }).click();
  await visit(page, "03-category-gallery");
  await page.getByRole("button", { name: "Table" }).click();
  await visit(page, "04-entry", { view: "entry", id: "e_vex" });
  await expect(page.locator(".reverse-links")).toContainText("Rules");
  // A two-way relationship the entry already lists isn't repeated.
  await expect(page.locator(".reverse-links")).not.toContainText("Partners");
  await page.getByRole("button", { name: "History" }).click();
  await visit(page, "05-entry-history");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Family" }).click();
  await visit(page, "06-family-tree");
  await expect(page.locator(".family-card")).toHaveCount(4); // parent, sister, Vex, partner
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Share" }).click();
  await visit(page, "07-entry-share-menu");
  await page.keyboard.press("Escape");
  // The chapters Vex is part of, and how.
  await expect(page.locator(".backlinks")).toContainText("In the story");
  await expect(page.locator(".backlinks")).toContainText("point of view");
  await visit(page, "08-place", { view: "entry", id: "e_harbour" });
  await visit(page, "09-fields", { view: "schema", typeId: "t_char" });

  // Writing
  await visit(page, "10-chapter", { view: "project", id: "p_book", docId: "d_ch1" });
  // Scene details: POV, place, date, threads and who's there.
  await page.locator('button[title^="Scene:"]').click();
  await expect(page.locator(".scene-panel .scene-people")).toContainText("Vex Arandel");
  await expect(page.locator(".scene-panel .scene-people")).toContainText("Rhys Arandel");
  await visit(page, "10a-scene-panel");
  // Rhys is in two places on the same day (Chapter 1 and 2): continuity notices.
  await page.locator('button[title^="Continuity"]').click();
  await expect(page.locator(".continuity-list")).toContainText("Rhys Arandel is at Highmoor Harbour");
  await visit(page, "10b-continuity");
  await page.locator('button[title^="Continuity"]').click();
  await page.locator(".ProseMirror").first().getByText("running").click({ button: "right" });
  await expect(page.locator(".menu")).toBeVisible();
  await expect(page.getByText("Thesaurus…")).toBeVisible();
  // Everyday words from the main meaning, already in the right form.
  await expect(page.locator(".menu")).toContainText("hurrying");
  await visit(page, "11-right-click-word");
  await page.getByText("Thesaurus…").click();
  await expect(page.locator(".thesaurus .thes-sense").first()).toBeVisible();
  await visit(page, "12-thesaurus");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Cards" }).click();
  await visit(page, "13-cards");
  await page.getByRole("button", { name: "Outline" }).click();
  await visit(page, "14-outline");
  await page.locator(".mode-bar .segmented button", { hasText: "Threads" }).click();
  await expect(page.locator(".thread-cell.on")).toHaveCount(2);
  await visit(page, "14a-threads");
  await page.locator(".mode-bar .segmented button", { hasText: "Write" }).click();
  await visit(page, "15-folder-as-one", { view: "project", id: "p_book", docId: "d_part" });
  await visit(page, "16-whole-book", { view: "project", id: "p_book", docId: "book" });
  await visit(page, "17-chapter-again", { view: "project", id: "p_book", docId: "d_ch1" });
  await page.locator('button[title^="Side by side"]').click();
  await page.locator(".split-options button", { hasText: "Highmoor Harbour" }).click();
  await visit(page, "18-side-by-side");
  await page.locator('button[title^="Side by side"]').click();
  await page.locator('button[title^="Find in book"]').click();
  await visit(page, "19-find-in-book");
  await page.keyboard.press("Escape");
  await expect(page.locator(".binder-foot .deadline")).toContainText("words a day");
  await page.locator('button[title^="Export as"]').click();
  await page.locator(".format-list button", { hasText: "Print-ready PDF" }).click();
  await expect(page.getByText("Trim size")).toBeVisible();
  await visit(page, "19a-export-pdf");
  await page.locator(".segmented button", { hasText: "Manuscript" }).click();
  await expect(page.getByText("Standard manuscript format")).toBeVisible();
  await visit(page, "19b-export-manuscript");
  await page.keyboard.press("Escape");

  // Everything else
  await visit(page, "20-timeline", { view: "timeline" });
  await expect(page.locator(".chronicle li.story").first()).toContainText("in the story");
  await visit(page, "21-calendar", { view: "calendar" });
  await visit(page, "22-maps", { view: "maps" });
  await visit(page, "23-map", { view: "map", id: "m_isles" });
  await visit(page, "24-graph", { view: "graph" });
  await visit(page, "25-settings", { view: "settings" });
  // With the assistant turned on, Settings shows the graphics card it will use (this once crashed).
  await page.getByText("Turn on the built-in assistant").click();
  await visit(page, "26-settings-assistant-on");
  await expect(page.getByText(/Runs on: Sample Graphics 8GB/)).toBeVisible();

  const missing = await page.evaluate(() => [...window.__smoke.missing]);
  if (missing.length) console.log(`Commands without a stand-in (returned nothing): ${missing.join(", ")}`);
});
