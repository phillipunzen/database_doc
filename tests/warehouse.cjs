// Warehouse UI against an isolated fixture instance, never the development database.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const baseURL = process.env.WAREHOUSE_TEST_URL;
if (!baseURL)
  throw new Error(
    "WAREHOUSE_TEST_URL must point to an isolated fixture instance.",
  );
const out = path.resolve(__dirname, "../docs");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      locale: "de-DE",
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    });
    await page.addInitScript(() =>
      Object.defineProperty(crypto, "randomUUID", { value: undefined }),
    );
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(baseURL);
    await page.locator('[name="username"]').fill("admin");
    await page
      .locator('[name="password"]')
      .fill(process.env.WAREHOUSE_TEST_PASSWORD || "dwh-ui-fixture-password");
    await page.locator('#login-form [type="submit"]').click();
    await page.locator('[data-action="nav"][data-view="warehouse"]').click();
    await page
      .getByRole("heading", { name: "Data Warehouse", exact: true })
      .waitFor();
    if (!(await page.locator('[data-action="dwh-create"]').isVisible()))
      await page.locator(".wh-standalone > summary").click();
    await page.locator('[data-action="dwh-create"]').click();
    await page
      .locator('#dwh-project-form [name="name"]')
      .fill("Sales Warehouse · Beispiel");
    await page
      .locator('[name="goal"]')
      .fill(
        "Täglicher Nettoumsatz nach Kunde; Kundenhistorie über SCD Typ 2. <script>literal</script>",
      );
    await page.locator('[data-action="dwh-wizard-next"]').click();
    await page.locator("#dwh-target_kind").selectOption("postgresql");
    assert.equal(
      await page.locator('[name="target_schema"]').inputValue(),
      "public",
    );
    await page.locator('[name="target_schema"]').fill("warehouse");
    await page.locator('[data-action="dwh-wizard-next"]').click();
    await page.locator("#dwh-source-ids").selectOption("1");
    await page.locator(".dwh-target-optional summary").click();
    await page.locator("#dwh-target-source").selectOption("2");
    await page.locator('#dwh-project-form [type="submit"]').click();
    await page
      .getByRole("heading", { name: "Sales Warehouse · Beispiel", exact: true })
      .waitFor();
    assert.equal(await page.locator(".content script").count(), 0);
    const projectId = Number(new URL(page.url()).hash.split("/")[1]);
    const me = await (await page.request.get(baseURL + "/api/auth/me")).json();
    const api = async (url, method = "GET", data) => {
      const r = await page.request.fetch(baseURL + url, {
        method,
        data,
        headers: { "x-csrf-token": me.csrf },
      });
      assert.ok(r.ok(), await r.text());
      return await r.json();
    };
    const endpoint = "/api/dwh/projects/" + projectId;
    fs.mkdirSync(out, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(out, "dwh-planning.png"),
      fullPage: true,
    });
    await page.locator('[data-action="dwh-tab"][data-tab="model"]').click();
    await page.locator('[data-action="dwh-import"]').click();
    await page.locator("#dwh-import-keys").selectOption(['["","customers"]']);
    await page.locator('#dwh-import-form [type="submit"]').click();
    await page
      .getByRole("heading", { name: "stg_customers", exact: true })
      .waitFor();
    let p = await api(endpoint);
    assert.equal(p.tables[0].columns[1].mapping.column_name, "name");
    await page.locator('[data-action="dwh-edit-table"]').click();
    await page.locator('#dwh-table-form [name="name"]').fill("dim_customer");
    await page.locator("#dwh-role").selectOption("dimension");
    await page.locator("#dwh-layer").selectOption("core");
    await page.locator('[name="grain"]').fill("Eine Zeile je Kunde");
    await page
      .locator('[name="load_strategy"]')
      .fill("Täglich; Kundenhistorie als SCD Typ 2 planen");
    await page.locator('#dwh-table-form [type="submit"]').click();
    await page
      .getByRole("heading", { name: "dim_customer", exact: true })
      .waitFor();
    // Editing mapping and a portable target type preserves the pinned source scan.
    await page.locator('[data-action="dwh-edit-column"]').first().click();
    await page.locator("#dwh-data_type").selectOption("bigint");
    await page.locator('[name="identity"]').check();
    await page.locator("#dwh-purpose").selectOption("technical_key");
    await page.locator('#dwh-column-form [type="submit"]').click();
    await page
      .locator(".object-detail")
      .getByText("Automatischer Schlüssel", { exact: true })
      .waitFor();
    // New facts and columns use UUIDs even on non-secure HTTP origins.
    await page.locator('[data-action="dwh-add-table"]').click();
    await page.locator('#dwh-table-form [name="name"]').fill("fact_sales");
    await page.locator("#dwh-role").selectOption("fact");
    await page.locator("#dwh-layer").selectOption("mart");
    await page.locator('[name="grain"]').fill("Eine Zeile je Bestellposition");
    await page.locator('#dwh-table-form [type="submit"]').click();
    await page
      .getByRole("heading", { name: "fact_sales", exact: true })
      .waitFor();
    for (const column of [
      {
        name: "customer_id",
        type: "bigint",
        purpose: "attribute",
        source: "customer_id",
      },
      {
        name: "net_amount",
        type: "decimal",
        purpose: "measure",
        source: "amount",
      },
    ]) {
      await page.locator('[data-action="dwh-add-column"]').click();
      await page.locator('#dwh-column-form [name="name"]').fill(column.name);
      await page.locator("#dwh-data_type").selectOption(column.type);
      await page.locator("#dwh-purpose").selectOption(column.purpose);
      await page.locator('[name="nullable"]').uncheck();
      await page.locator("#dwh-mapping-source").selectOption("1");
      await page.locator("#dwh-mapping-table").selectOption("1");
      await page.locator("#dwh-mapping-column").selectOption(column.source);
      await page
        .locator('[name="transformation"]')
        .fill(
          column.purpose === "measure"
            ? "Nettobetrag je Bestellposition; Einheit EUR"
            : "Kundenschlüssel aus dem Quellsystem",
        );
      await page.locator('#dwh-column-form [type="submit"]').click();
      await page.locator("#dwh-column-form").waitFor({ state: "hidden" });
    }
    await page.locator('[data-action="dwh-add-relation"]').click();
    await page.locator("#dwh-relation-columns").fill("customer_id");
    await page.locator('#dwh-relation-form [type="submit"]').click();
    await page
      .getByText("customer_id → dim_customer (id)", { exact: true })
      .waitFor();
    assert.equal(await page.locator(".dwh-diagram-node").count(), 2);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(out, "dwh-model.png"),
      fullPage: true,
    });
    await page.locator('[data-action="dwh-tab"][data-tab="mappings"]').click();
    await page
      .getByText("Nettobetrag je Bestellposition; Einheit EUR", { exact: true })
      .waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(out, "dwh-mappings.png"),
      fullPage: true,
    });
    for (const format of ["sql", "json", "markdown"]) {
      const [file] = await Promise.all([
        page.waitForEvent("download"),
        page
          .locator(`[data-action="dwh-export"][data-format="${format}"]`)
          .click(),
      ]);
      assert.equal(await file.failure(), null);
      assert.equal(
        file.suggestedFilename(),
        `databasedoc-dwh-${projectId}.${format === "markdown" ? "md" : format}`,
      );
    }
    await page.locator('[data-action="dwh-tab"][data-tab="progress"]').click();
    await Promise.all([
      page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" &&
          new URL(response.url()).pathname === endpoint &&
          response.ok(),
      ),
      page
        .getByLabel("Umsetzungsstatus fact_sales", { exact: true })
        .selectOption("in_progress"),
    ]);
    p = await api(endpoint);
    assert.equal(
      p.tables.find((t) => t.name === "fact_sales").status,
      "in_progress",
    );
    await page.locator('[data-action="dwh-tab"][data-tab="check"]').click();
    await page.locator('[data-action="dwh-compare"]').click();
    await page.getByText(/Tabellen entsprechen dem Plan/).waitFor();
    await page
      .getByText("Tabelle fehlt im gescannten Zielschema.", { exact: true })
      .waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(out, "dwh-comparison.png"),
      fullPage: true,
    });
    await page.reload();
    await page
      .getByRole("heading", { name: "Sales Warehouse · Beispiel", exact: true })
      .waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-action="dwh-tab"][data-tab="model"]').click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Mobile warehouse model overflows",
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: path.join(out, "dwh-mobile.png"),
      fullPage: true,
    });
    // Stale project writes show a conflict without throwing away the open form.
    await page.locator('[data-action="dwh-edit-table"]').click();
    await page.locator('[name="grain"]').fill("Unsaved change");
    p = await api(endpoint);
    const body = Object.fromEntries(
      [
        "name",
        "goal",
        "target_kind",
        "target_schema",
        "target_source_id",
        "source_ids",
        "tables",
        "version",
      ].map((k) => [k, p[k]]),
    );
    body.goal += " Another editor update.";
    await api(endpoint, "PUT", body);
    await page.locator('#dwh-table-form [type="submit"]').click();
    await page
      .getByRole("alert")
      .filter({ hasText: "inzwischen geändert" })
      .waitFor();
    assert.equal(
      await page.locator('[name="grain"]').inputValue(),
      "Unsaved change",
    );
    await page.locator('[data-action="close-modal"]').click();
    // Viewer grants cover both source and target; they never permit plan changes.
    const user = await api("/api/users", "POST", {
      username: "dwh-viewer-" + Date.now(),
      display_name: "Projektleser",
      password: "dwh-fixture-viewer-password",
      role: "viewer",
    });
    for (const source of [1, 2])
      await api(`/api/sources/${source}/grants`, "PUT", {
        user_id: user.id,
        edit: false,
        data: false,
      });
    await page.context().clearCookies();
    await page.goto(baseURL);
    await page.locator('[name="username"]').fill(user.username);
    await page.locator('[name="password"]').fill("dwh-fixture-viewer-password");
    await page.locator('#login-form [type="submit"]').click();
    await page.goto(baseURL + "/#warehouse-project/" + projectId);
    await page
      .getByRole("heading", { name: "Sales Warehouse · Beispiel", exact: true })
      .waitFor();
    assert.equal(await page.locator('[data-action="dwh-settings"]').count(), 0);
    await page.locator('[data-action="dwh-tab"][data-tab="model"]').click();
    assert.equal(
      await page.locator('[data-action="dwh-add-table"]').count(),
      0,
    );
    await page.locator('[data-action="dwh-tab"][data-tab="progress"]').click();
    assert.ok(
      await page
        .getByLabel("Umsetzungsstatus fact_sales", { exact: true })
        .isDisabled(),
    );
    await page.context().clearCookies();
    await page.goto(baseURL);
    await page.locator('[name="username"]').fill("admin");
    await page
      .locator('[name="password"]')
      .fill(process.env.WAREHOUSE_TEST_PASSWORD || "dwh-ui-fixture-password");
    await page.locator('#login-form [type="submit"]').click();
    await page.goto(baseURL + "/#warehouse-project/" + projectId);
    await page.locator('[data-action="dwh-settings"]').click();
    await page.locator('[data-action="dwh-delete-project"]').click();
    await page.locator('[data-action="dwh-confirm-delete-project"]').click();
    await page
      .getByRole("heading", { name: "Data Warehouse", exact: true })
      .waitFor();
    assert.equal((await page.request.get(baseURL + endpoint)).status(), 404);
    assert.equal(
      (await (await page.request.get(baseURL + "/api/sources")).json()).length,
      2,
    );
    assert.deepEqual(errors, []);
    console.log(
      "Warehouse browser passed: project creation, imports, target model, mappings, relationships, SQL/JSON/Markdown downloads, statuses, target comparison, reload, optimistic conflicts, read-only roles and mobile layout. Fictional fixture screenshots only.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
