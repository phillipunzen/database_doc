// Real PDF downloads from the existing demo. No scans, preview reads or source edits.
const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("node:assert/strict");
const projectRoot = path.resolve(__dirname, "..");
const config = fs.readFileSync(path.join(projectRoot, ".env"), "utf8");
const value = (key) => config.match(new RegExp("^" + key + "=(.*)$", "m"))?.[1];
const baseURL =
  process.env.APP_URL || value("APP_URL") || "http://localhost:8090";
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const output = fs.mkdtempSync(
    path.join(os.tmpdir(), "datatlas-pdf-browser-"),
  );
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(baseURL);
    if (await page.locator("#login-form").count()) {
      await page
        .locator('[name="username"]')
        .fill(value("ADMIN_USERNAME") || "admin");
      await page.locator('[name="password"]').fill(value("ADMIN_PASSWORD"));
      await page.locator('#login-form [type="submit"]').click();
    }
    await page
      .getByRole("heading", { name: "Datenquellen", exact: true })
      .waitFor();
    const listing = await (
      await page.request.get(baseURL + "/api/sources")
    ).json();
    const demo = listing.find(
      (s) => s.config?.path === "/sources/beispiel.sqlite",
    );
    assert.ok(demo?.snapshot_id, "Existing scanned example source is required");
    await page
      .locator(`[data-action="open"][data-id="${demo.id}"]`)
      .first()
      .click();
    await page.getByRole("heading", { name: demo.name, exact: true }).waitFor();
    async function download(action, expectedSuffix) {
      const [file] = await Promise.all([
        page.waitForEvent("download"),
        page.locator(`[data-action="${action}"]`).click(),
      ]);
      assert.equal(await file.failure(), null);
      assert.equal(
        file.suggestedFilename(),
        `datatlas-${demo.id}-${expectedSuffix}.pdf`,
      );
      const target = path.join(output, file.suggestedFilename());
      await file.saveAs(target);
      assert.equal(fs.readFileSync(target).subarray(0, 5).toString(), "%PDF-");
      assert.ok(fs.statSync(target).size > 1000);
      return target;
    }
    await download("pdf-tables", "tables");
    await page
      .locator('.tab[data-action="source-tab"][data-tab="schema"]')
      .click();
    await page.locator('[data-action="pdf-table"]').waitFor();
    const requestPromise = page.waitForRequest(
      (req) =>
        req.url().includes("/export?") &&
        new URL(req.url()).searchParams.has("table_key"),
    );
    await download("pdf-table", "table");
    const tableRequest = await requestPromise;
    const params = new URL(tableRequest.url()).searchParams;
    assert.equal(params.get("format"), "pdf");
    assert.equal(Number(params.get("snapshot_id")), demo.snapshot_id);
    assert.ok(JSON.parse(params.get("table_key")).length === 2);
    await page.locator('[data-action="source-tab"][data-tab="er"]').click();
    await download("pdf-er", "er");
    // A failed export keeps the user on the source and re-enables the button.
    await page.route("**/api/sources/*/export?**", (route) =>
      route.fulfill({
        status: 404,
        json: { detail: "PDF-Test: Schema-Stand nicht verfügbar." },
      }),
    );
    await page.locator('[data-action="pdf-er"]').click();
    await page
      .getByText("PDF-Test: Schema-Stand nicht verfügbar.", { exact: true })
      .waitFor();
    assert.ok(await page.locator('[data-action="pdf-er"]').isEnabled());
    await page.unroute("**/api/sources/*/export?**");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.locator('[data-action="pdf-er"]').isVisible());
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Mobile ER page overflows",
    );
    await page
      .locator('.tab[data-action="source-tab"][data-tab="schema"]')
      .click();
    assert.ok(await page.locator('[data-action="pdf-table"]').isVisible());
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Mobile table page overflows",
    );
    await download("pdf-table", "table");
    assert.deepEqual(errors, []);
    console.log(
      "PDF browser passed: complete schema, single table, ER downloads, exact snapshot selection, error handling and mobile layout. Files are in " +
        output,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
