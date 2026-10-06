// UI checks with 67 simulated sources. No application data is written.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const assert = require("node:assert/strict");
const projectRoot = path.resolve(__dirname, "..");
const config = fs.existsSync(path.join(projectRoot, ".env"))
  ? fs.readFileSync(path.join(projectRoot, ".env"), "utf8")
  : "";
const baseURL =
  process.env.APP_URL ||
  config.match(/^APP_URL=(.*)$/m)?.[1] ||
  "http://localhost:8090";
const kinds = ["mssql", "mysql", "mariadb", "postgresql", "mongodb", "sqlite"];
const sources = Array.from({ length: 67 }, (_, i) => {
  const kind = kinds[i % kinds.length];
  const documented = i % 4 !== 1;
  return {
    id: 1000 + i,
    name: `Katalog-Test ${String(i + 1).padStart(2, "0")}${i === 6 ? " <script> & Sonderzeichen" : ""}`,
    kind,
    config: {
      host: `db-${(i % 5) + 1}.example.invalid`,
      database: `warehouse_${String(i + 1).padStart(2, "0")}`,
      path: "/sources/fixture.sqlite",
      schema: i % 2 ? "analytics" : "",
    },
    can_edit: true,
    can_data: true,
    snapshot_id: documented ? i + 1 : null,
    scanned_at: documented
      ? `2026-10-05T${String(i % 24).padStart(2, "0")}:00:00`
      : null,
    table_count: documented ? i * 7 + 3 : 0,
    column_count: documented ? i * 30 + 10 : 0,
    relation_count: documented ? i * 2 : 0,
    job:
      i % 4 === 2
        ? { id: i, status: "failed", message: "Fixture scan failed." }
        : i % 4 === 3
          ? { id: i, status: "running", message: "Fixture scan running." }
          : null,
  };
});
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        json: {
          user: {
            id: 1,
            username: "fixture",
            display_name: "UI Test",
            role: "admin",
            provider: "local",
          },
          csrf: "fixture-csrf",
        },
      }),
    );
    await page.route("**/api/sources", (route) => {
      assert.equal(route.request().method(), "GET");
      return route.fulfill({ json: sources });
    });
    await page.route("**/api/sources/*/snapshot", (route) =>
      route.fulfill({
        json: {
          id: 1,
          created: "2026-10-05T10:00:00",
          payload: { tables: [], warnings: [] },
          notes: {},
        },
      }),
    );
    await page.goto(baseURL + "/#sources");
    await page
      .getByRole("heading", { name: "Datenquellen", exact: true })
      .waitFor();
    const rows = page.locator(".source-list tbody tr");
    assert.equal(await rows.count(), 25);
    assert.equal(
      await page.locator("#source-range").textContent(),
      "1–25 von 67",
    );
    assert.equal(
      await page.locator("#source-count").textContent(),
      "67 Datenquellen",
    );
    await page
      .getByRole("button", { name: "Nächste Seite", exact: true })
      .click();
    assert.equal(await rows.count(), 25);
    assert.equal(
      await page.locator("#source-range").textContent(),
      "26–50 von 67",
    );
    await page
      .getByRole("button", { name: "Nächste Seite", exact: true })
      .click();
    assert.equal(await rows.count(), 17);
    assert.equal(
      await page.locator("#source-range").textContent(),
      "51–67 von 67",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Nächste Seite", exact: true })
        .isDisabled(),
      true,
    );
    await page.getByLabel("Pro Seite", { exact: true }).selectOption("50");
    assert.equal(await rows.count(), 50);
    assert.equal(
      await page.locator("#source-range").textContent(),
      "1–50 von 67",
    );
    await page.getByLabel("Pro Seite", { exact: true }).selectOption("100");
    assert.equal(await rows.count(), 67);
    await page.getByLabel("Pro Seite", { exact: true }).selectOption("25");
    await page.getByRole("button", { name: /^PostgreSQL / }).click();
    const pg = sources.filter((s) => s.kind === "postgresql");
    assert.equal(await rows.count(), pg.length);
    await page
      .getByLabel("Nach Server filtern", { exact: true })
      .selectOption("db-4.example.invalid");
    assert.equal(
      await rows.count(),
      pg.filter((s) => s.config.host === "db-4.example.invalid").length,
    );
    await page
      .getByLabel("Nach Scan-Status filtern", { exact: true })
      .selectOption("running");
    assert.equal(
      await rows.count(),
      pg.filter(
        (s) =>
          s.config.host === "db-4.example.invalid" &&
          s.job?.status === "running",
      ).length,
    );
    await page.locator("#reset-source-filters").click();
    assert.equal(await rows.count(), 25);
    const search = page.getByLabel("Datenquellen durchsuchen", { exact: true });
    await search.fill("warehouse_66 db-1");
    assert.equal(await rows.count(), 1);
    assert.match(await rows.first().textContent(), /Katalog-Test 66/);
    await search.fill("no matching sources");
    await page
      .getByRole("heading", { name: "Keine passenden Quellen", exact: true })
      .waitFor();
    await page
      .locator("#source-results")
      .getByRole("button", { name: "Filter zurücksetzen", exact: true })
      .click();
    await page
      .getByLabel("Datenquellen sortieren", { exact: true })
      .selectOption("table_count");
    assert.equal(
      await rows.first().getAttribute("data-source-id"),
      String(
        sources.reduce((a, b) => (a.table_count > b.table_count ? a : b)).id,
      ),
    );
    await page
      .getByRole("button", { name: "Aufsteigend sortieren", exact: true })
      .click();
    assert.equal(await rows.first().locator(".numeric").textContent(), "—");
    await page
      .locator("th")
      .getByRole("button", { name: /^Datenquelle/ })
      .click();
    assert.match(await rows.first().textContent(), /Katalog-Test 01/);
    // Markup-like source names must render as text, without injecting elements.
    assert.equal(await page.locator(".source-list script").count(), 0);
    assert.match(
      await page
        .getByRole("button", {
          name: "Katalog-Test 07 <script> & Sonderzeichen",
          exact: true,
        })
        .textContent(),
      /<script>/,
    );
    await page
      .getByRole("button", { name: "Nächste Seite", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Katalog-Test 26", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "Katalog-Test 26", exact: true })
      .waitFor();
    assert.equal(
      await page.locator(".source-heading .database-logo").count(),
      1,
    );
    await page
      .getByRole("button", { name: "Alle Datenquellen", exact: true })
      .click();
    assert.equal(
      await page.locator("#source-range").textContent(),
      "26–50 von 67",
    );
    await page
      .getByRole("button", { name: "Kartenansicht", exact: true })
      .click();
    assert.equal(await page.locator(".source-card").count(), 25);
    await page
      .getByRole("button", { name: "Listenansicht", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Vorherige Seite", exact: true })
      .click();
    await page.locator(".database-logo").first().waitFor();
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".database-logo")].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    fs.mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(projectRoot, "docs/catalog-67-sources.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(projectRoot, "docs/catalog-67-sources-mobile.png"),
      fullPage: true,
    });
    await page
      .getByLabel("Datenquellen durchsuchen", { exact: true })
      .fill("warehouse_60");
    assert.equal(await rows.count(), 1);
    await page.locator("#reset-source-filters").click();
    // Empty catalogs and restricted roles retain the correct entry actions.
    sources.splice(0);
    await page.reload();
    await page
      .getByRole("heading", { name: "Deine erste Datenquelle", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Datenquelle hinzufügen", exact: true })
        .count(),
      2,
    );
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        json: {
          user: {
            id: 2,
            username: "viewer",
            display_name: "Viewer fixture",
            role: "viewer",
            provider: "local",
          },
          csrf: "fixture-csrf",
        },
      }),
    );
    await page.reload();
    await page
      .getByRole("heading", { name: "Deine erste Datenquelle", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Datenquelle hinzufügen", exact: true })
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Catalog UI passed: 67 sources, pagination, combined filters, search, sorting, escaped names, navigation, card/list views, six logos, mobile layout, and empty admin/viewer catalogs.",
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
