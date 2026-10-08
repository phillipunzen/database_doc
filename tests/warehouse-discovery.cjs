// Real guided discovery and atomic structure adoption on an isolated fixture.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const baseURL = process.env.WAREHOUSE_DISCOVERY_TEST_URL;
const password = process.env.WAREHOUSE_DISCOVERY_TEST_PASSWORD;
if (!baseURL || !password)
  throw new Error(
    "Set WAREHOUSE_DISCOVERY_TEST_URL and WAREHOUSE_DISCOVERY_TEST_PASSWORD for an isolated instance with /tmp/customer-analysis.sqlite and /tmp/machine-analysis.sqlite fixtures.",
  );
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const locale of ["de-DE", "en-US"]) {
      const context = await browser.newContext({
        locale,
        viewport: { width: 1440, height: 1050 },
        acceptDownloads: true,
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(baseURL);
      await page.locator("#login-form").waitFor();
      await page.locator('[name="username"]').fill("admin");
      await page.locator('[name="password"]').fill(password);
      await page.locator('#login-form [type="submit"]').click();
      await page.locator("#source-results").waitFor();
      const csrf = await page.evaluate(() => state.csrf);
      const call = async (method, url, body) => {
        const response = await context.request.fetch(baseURL + url, {
          method,
          headers: { "x-csrf-token": csrf },
          ...(body ? { data: body } : {}),
        });
        assert(response.ok(), await response.text());
        return response.json();
      };
      const sources = [];
      for (const [name, file] of [
        ["Customer application", "customer-analysis.sqlite"],
        ["Production telemetry", "machine-analysis.sqlite"],
      ]) {
        const source = await call("POST", "/api/sources", {
          name: name + " " + locale,
          kind: "sqlite",
          path: "/tmp/" + file,
        });
        sources.push(source);
        await call("POST", `/api/sources/${source.id}/scan`);
        await page.waitForFunction(async (id) => {
          const r = await fetch(`/api/sources/${id}`);
          return (await r.json()).snapshot_id;
        }, source.id);
      }
      const workspace = await call("POST", "/api/dwh/warehouses", {
        name: "Company warehouse " + locale,
        goal: "Customers and machine measurements",
        target_kind: "postgresql",
        target_schema: "warehouse",
        source_ids: [],
      });
      try {
        await page.goto(
          baseURL +
            `/#warehouse-workspace/${workspace.id}?phase=overview&step=sources`,
        );
        await page
          .locator('.wh-guide-current[data-guide-step="sources"]')
          .waitFor();
        assert.equal(await page.locator(".wh-guide-current").count(), 1);
        await page
          .locator('.wh-guide-main-action [data-action="wh-guide-sources"]')
          .click();
        await page
          .locator("#wh-guide-source-query")
          .fill("Customer application");
        assert.equal(
          await page.locator(".wh-guide-source-picker label:visible").count(),
          1,
        );
        await page
          .locator(`#wh-guide-sources-form [value="${sources[0].id}"]`)
          .check();
        await page.locator('#wh-guide-sources-form [type="submit"]').click();
        await page.waitForFunction(
          (id) => state.dwhProject.source_ids.includes(id),
          sources[0].id,
        );
        await page.locator('.wh-guide-nav-step[data-id="subjects"]').click();
        await page
          .locator('.wh-guide-main-action [data-action="wh-add-area"]')
          .click();
        await page
          .locator('#wh-area-form [name="name"]')
          .fill("Customer analysis");
        await page
          .locator('#wh-area-form [name="goal"]')
          .fill("Kundenauswertung");
        await page.locator('#wh-area-form [name="department"]').fill("Sales");
        await page.locator('#wh-area-form [name="owner"]').fill("Sales team");
        await page.locator('#wh-area-form [type="submit"]').click();
        await page.waitForFunction(() => state.wh.areas.length === 1);
        await page.waitForFunction(() =>
          document
            .querySelector(".wh-discovery-candidates")
            ?.textContent.includes("customers"),
        );
        assert.equal(
          await page.locator("#wh-discovery-query").inputValue(),
          "Kundenauswertung",
        );
        assert(
          (
            await page.locator(".wh-discovery-candidates").textContent()
          ).includes(
            locale === "de-DE" ? "Mögliche Dimension" : "Possible dimension",
          ),
        );
        const customer = page
          .locator(".wh-discovery-candidates article")
          .filter({ has: page.locator("h4", { hasText: /customers$/ }) });
        await customer.locator('[data-action="wh-discovery-adopt"]').click();
        await page.locator('#wh-discovery-adopt-form [type="submit"]').click();
        await page
          .locator('.wh-guide-current[data-guide-step="model"]')
          .waitFor();
        let p = await page.evaluate(() => state.dwhProject);
        assert.equal(p.tables.length, 1);
        assert.equal(p.tables[0].role, "staging");
        assert(
          p.tables[0].columns.every(
            (c) => c.mapping.source_id === sources[0].id,
          ),
        );
        assert.equal(
          await page.evaluate(() => state.wh.areas[0].table_ids.length),
          1,
        );
        // Searching across all sources finds a connection not yet bound to this warehouse.
        await page.locator("#wh-discovery-query").fill("Maschinenmessdaten");
        await page.waitForFunction(() =>
          document
            .querySelector(".wh-discovery-candidates")
            ?.textContent.includes("sensor_measurements"),
        );
        assert(
          (
            await page.locator(".wh-discovery-candidates").textContent()
          ).includes(
            locale === "de-DE"
              ? "Mögliche Faktentabelle"
              : "Possible fact table",
          ),
        );
        assert(!p.source_ids.includes(sources[1].id));
        await page
          .locator(".wh-discovery-candidates article")
          .filter({ hasText: "sensor_measurements" })
          .locator('[data-action="wh-discovery-adopt"]')
          .click();
        await page.locator('#wh-discovery-adopt-form [type="submit"]').click();
        await page.waitForFunction(
          (id) => state.dwhProject.source_ids.includes(id),
          sources[1].id,
        );
        p = await page.evaluate(() => state.dwhProject);
        assert.equal(p.tables.length, 2);
        assert.equal(
          await page.evaluate(() => state.wh.areas[0].table_ids.length),
          2,
        );
        // Navigation is not evidence that external SQL or load jobs have run.
        await page
          .locator('.wh-guide-nav-step[data-id="implementation"]')
          .click();
        await page.locator(".wh-guide-other-actions summary").click();
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          page.locator('[data-action="wh-guide-plan"]').click(),
        ]);
        const file = await download.path();
        const plan = fs.readFileSync(file, "utf8");
        assert(
          plan.includes("stg_customers") &&
            plan.includes("sensor_measurements") &&
            plan.includes("customer_id"),
        );
        assert.match(plan, locale === "de-DE" ? /Ladejob/ : /load job/);
        assert.equal(
          await page
            .locator('.wh-guide-nav-step[data-id="implementation"] small')
            .textContent(),
          locale === "de-DE" ? "Ausstehend" : "Pending",
        );
        await page.reload();
        await page
          .locator('.wh-guide-current[data-guide-step="implementation"]')
          .waitFor();
        await page.locator('.wh-guide-nav-step[data-id="model"]').click();
        await page.locator("#wh-discovery-query").fill("Kundenauswertung");
        await page.waitForFunction(() =>
          document
            .querySelector(".wh-discovery-candidates")
            ?.textContent.includes("customers"),
        );
        await page.setViewportSize({ width: 390, height: 844 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page.locator(".wh-toolbar > summary").click();
        const menu = await page.locator(".wh-toolbar > .actions").boundingBox();
        assert(menu.x >= 0 && menu.x + menu.width <= 391);
        await page.locator(".wh-toolbar > summary").click();
        if (locale === "en-US")
          await page.screenshot({
            path: path.resolve(
              __dirname,
              "../docs/warehouse-discovery-mobile.png",
            ),
            fullPage: true,
          });
        await page.setViewportSize({ width: 1440, height: 1050 });
        if (locale === "en-US")
          await page.screenshot({
            path: path.resolve(__dirname, "../docs/warehouse-discovery.png"),
            fullPage: true,
          });
        assert.deepEqual(errors, []);
      } finally {
        const current = await call(
          "GET",
          `/api/dwh/warehouses/${workspace.id}`,
        );
        await call(
          "DELETE",
          `/api/dwh/warehouses/${workspace.id}?version=${current.project.version}`,
        );
        const p = await call(
          "GET",
          `/api/dwh/projects/${workspace.project.id}`,
        );
        await call("DELETE", `/api/dwh/projects/${p.id}?version=${p.version}`);
        for (const source of sources)
          await call("DELETE", `/api/sources/${source.id}`);
      }
      await context.close();
      console.log(
        "Guided discovery, automatic classification, cross-source adoption, reload and mobile passed: " +
          locale,
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
