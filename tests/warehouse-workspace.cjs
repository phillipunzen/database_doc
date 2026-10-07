// Real workspace CRUD against an isolated instance seeded with fictional source metadata.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const baseURL = process.env.WORKSPACE_TEST_URL;
const password = process.env.WORKSPACE_TEST_PASSWORD;
if (!baseURL || !password)
  throw new Error(
    "Use WORKSPACE_TEST_URL and WORKSPACE_TEST_PASSWORD for a disposable fixture.",
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
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true,
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(baseURL + "/#warehouse");
      await page.locator("#login-form").waitFor();
      await page.locator('[name="username"]').fill("admin");
      await page.locator('[name="password"]').fill(password);
      await page.locator('#login-form [type="submit"]').click();
      await page.locator('[data-action="wh-create"]').waitFor();
      await page.locator('[data-action="wh-create"]').click();
      await page
        .locator('#dwh-project-form [name="name"]')
        .fill("Example Warehouse");
      await page
        .locator('#dwh-project-form [name="goal"]')
        .fill("Daily sales and purchasing by product, with shared dimensions.");
      await page.locator('[data-action="dwh-wizard-next"]').click();
      await page.locator("#dwh-target_kind").selectOption("postgresql");
      await page
        .locator('#dwh-project-form [name="target_schema"]')
        .fill("warehouse");
      await page.locator('[data-action="dwh-wizard-next"]').click();
      await page.locator("#dwh-source-ids").selectOption("1");
      await page.locator('#dwh-project-form [type="submit"]').click();
      await page.locator("#wh-view").waitFor();
      const warehouseId = await page.evaluate(() => state.wh.id);
      assert.equal(await page.locator('[data-action="wh-tab"]').count(), 6);
      const phase = async (name) => {
        await page
          .locator(`[data-action="wh-tab"][data-tab="${name}"]`)
          .click();
      };
      const area = async (name) => {
        await phase("areas");
        await page.locator('[data-action="wh-add-area"]').click();
        await page.locator('#wh-area-form [name="name"]').fill(name);
        await page
          .locator('#wh-area-form [name="goal"]')
          .fill("Daily " + name.toLowerCase() + " by product");
        await page
          .locator('#wh-area-form [name="owner"]')
          .fill("Data platform");
        await page.locator('#wh-area-form [type="submit"]').click();
        await page.waitForFunction(
          (name) =>
            !document.getElementById("modal").open &&
            state.wh.areas.some((area) => area.name === name),
          name,
        );
        return await page.evaluate(
          (name) => state.wh.areas.find((area) => area.name === name).id,
          name,
        );
      };
      const starter = async (areaId, fact) => {
        await page
          .locator(`[data-action="wh-starter"][data-id="${areaId}"]`)
          .click();
        await page.locator('#wh-starter-form [name="fact_name"]').fill(fact);
        await page
          .locator('#wh-starter-form [name="grain"]')
          .fill("One row per order line");
        await page
          .locator('#wh-starter-form [name="measure_name"]')
          .fill("net_amount");
        await page
          .locator('#wh-starter-form [name="measure_description"]')
          .fill("Net amount in EUR, excluding tax");
        await page.locator('#wh-starter-form [type="submit"]').click();
        await page.waitForFunction(
          (fact) =>
            !document.getElementById("modal").open &&
            state.dwhProject.tables.some((table) => table.name === fact),
          fact,
        );
      };
      const sales = await area("Sales");
      await starter(sales, "fact_sales");
      const purchasing = await area("Purchasing");
      await starter(purchasing, "fact_purchasing");
      const tables = await page.evaluate(() => state.dwhProject.tables);
      assert.equal(tables.length, 3);
      const calendar = tables.find((table) => table.name === "dim_date");
      assert(
        await page.evaluate(
          (id) => state.wh.areas.every((area) => area.table_ids.includes(id)),
          calendar.id,
        ),
      );
      await phase("model");
      assert.equal(await page.locator(".dwh-diagram-node").count(), 3);
      assert.equal(await page.locator("#wh-view tbody tr").count(), 3);
      await page.locator("#wh-filter").selectOption(sales);
      assert.equal(await page.locator(".dwh-diagram-node").count(), 2);
      await page.locator("#wh-query").fill("fact_sales");
      assert.equal(await page.locator("#wh-view tbody tr").count(), 1);
      await page.locator("#wh-query").fill("");
      await page.locator("#wh-filter").selectOption("");
      if (locale === "en-US") {
        await page.evaluate(() =>
          document.getElementById("toast").classList.remove("visible"),
        );
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/warehouse-global-model.png"),
          fullPage: true,
        });
      }
      await page.locator(`.dwh-diagram-node[data-id="${calendar.id}"]`).focus();
      await page
        .locator(`.dwh-diagram-node[data-id="${calendar.id}"]`)
        .press("Enter");
      await page.locator(".object-detail").waitFor();
      assert.equal(
        await page.locator(".object-detail h2").textContent(),
        "dim_date",
      );
      await page.reload();
      await page.locator(".object-detail").waitFor();
      assert.equal(
        await page.locator(".object-detail h2").textContent(),
        "dim_date",
      );
      await page.locator('[data-action="wh-return"]').click();
      await page.locator("#wh-view").waitFor();
      await phase("lineage");
      assert.equal(await page.locator("#wh-view tbody tr").count(), 8);
      await page
        .locator(
          `[data-action="wh-column"][data-id="${calendar.columns[1].id}"]`,
        )
        .click();
      await page
        .locator('#dwh-column-form [name="transformation"]')
        .fill("Generate one calendar row for each required date.");
      await page.locator('#dwh-column-form [type="submit"]').click();
      await page.waitForFunction(() => !document.getElementById("modal").open);
      assert(
        (await page.locator("#wh-view").textContent()).includes(
          "Generate one calendar row",
        ),
      );
      await phase("operations");
      await page.locator('[data-action="wh-add-task"]').click();
      await page
        .locator('#wh-task-form [name="title"]')
        .fill("Reconcile daily totals");
      await page.locator('#wh-task-form [name="area_id"]').selectOption(sales);
      await page.locator('#wh-task-form [name="status"]').selectOption("done");
      await page.locator('#wh-task-form [type="submit"]').click();
      await page.waitForFunction(
        () => document.getElementById("form-error").textContent.length > 0,
      );
      await page
        .locator('#wh-task-form [name="notes"]')
        .fill("Result: totals agree <script>literal</script>");
      await page.locator('#wh-task-form [name="owner"]').fill("Data platform");
      await page.locator('#wh-task-form [name="due_date"]').fill("2026-10-08");
      await page.locator('#wh-task-form [type="submit"]').click();
      await page.waitForFunction(
        () =>
          !document.getElementById("modal").open &&
          state.wh.tasks.some(
            (task) => task.title === "Reconcile daily totals",
          ),
      );
      assert(
        (await page.locator("#wh-view").textContent()).includes(
          "<script>literal</script>",
        ),
      );
      await page.locator('[data-action="wh-settings"]').click();
      await page.locator("#dwh-target-source").selectOption("2");
      await page.locator('#dwh-project-form [type="submit"]').click();
      await page.waitForFunction(
        () =>
          !document.getElementById("modal").open &&
          state.dwhProject.target_source_id === 2,
      );
      await phase("check");
      await page.locator('[data-action="wh-target-er"]').click();
      await page.locator('[data-action="wh-return"]').waitFor();
      assert.equal(await page.evaluate(() => state.tab), "er");
      await page.locator('[data-action="wh-return"]').click();
      await page.locator("#wh-view").waitFor();
      assert.equal(await page.evaluate(() => state.whTab), "check");
      await page.locator('[data-action="wh-target"]').click();
      await page.locator('[data-action="wh-return"]').waitFor();
      await page.locator('[data-action="wh-return"]').click();
      await page.locator("#wh-view").waitFor();
      assert.equal(await page.evaluate(() => state.wh.comparison.total), 3);
      const [sql] = await Promise.all([
        page.waitForEvent("download"),
        page.locator('[data-action="wh-sql"]').click(),
      ]);
      assert(sql.suggestedFilename().endsWith(".sql"));
      const [doc] = await Promise.all([
        page.waitForEvent("download"),
        page.locator('[data-action="wh-export"]').click(),
      ]);
      assert.equal(
        doc.suggestedFilename(),
        `databasedoc-warehouse-${warehouseId}.json`,
      );
      await phase("overview");
      if (locale === "en-US")
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/warehouse-roadmap.png"),
          fullPage: true,
        });
      const oldPlan = await page.evaluate(() => {
        const p = state.dwhProject;
        const body = Object.fromEntries(
          ["name", "goal", "target_kind", "target_schema", "source_ids"].map(
            (key) => [key, structuredClone(p[key])],
          ),
        );
        body.name = "Returns example";
        body.tables = structuredClone(
          p.tables.filter((table) =>
            ["dim_date", "fact_sales"].includes(table.name),
          ),
        );
        body.tables.find((table) => table.name === "fact_sales").name =
          "fact_returns";
        return { body, csrf: state.csrf };
      });
      const oldResponse = await context.request.post(
        baseURL + "/api/dwh/projects",
        { headers: { "X-CSRF-Token": oldPlan.csrf }, data: oldPlan.body },
      );
      assert.equal(oldResponse.status(), 200);
      const oldProject = await oldResponse.json();
      await page.locator('[data-action="wh-adopt"]').click();
      await page.locator("#dwh-project_id").selectOption(String(oldProject.id));
      await page.waitForFunction(
        (id) => state.whIncomingProject?.id === id,
        oldProject.id,
      );
      await page.locator(`#wh-reuse-${calendar.id}`).selectOption(calendar.id);
      await page.locator('#wh-adopt-form [type="submit"]').click();
      await page.waitForFunction(
        () =>
          !document.getElementById("modal").open &&
          state.dwhProject.tables.length === 4,
      );
      assert.equal(await page.evaluate(() => state.wh.areas.length), 3);
      assert.equal(
        await page.evaluate(
          () =>
            state.dwhProject.tables.filter((table) => table.name === "dim_date")
              .length,
        ),
        1,
      );
      assert.equal(
        (
          await context.request.get(
            baseURL + `/api/dwh/projects/${oldProject.id}`,
          )
        ).status(),
        200,
      );
      await phase("model");
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.route("**/api/auth/me", async (route) => {
        const response = await route.fetch();
        const result = await response.json();
        result.user.role = "viewer";
        await route.fulfill({ json: result });
      });
      await page.route(
        `**/api/dwh/warehouses/${warehouseId}`,
        async (route) => {
          assert.equal(route.request().method(), "GET");
          const response = await route.fetch();
          const result = await response.json();
          result.project.can_edit = false;
          await route.fulfill({ json: result });
        },
      );
      await page.reload();
      await page.locator("#wh-view").waitFor();
      assert.equal(
        await page.locator('[data-action="wh-settings"]').count(),
        0,
      );
      await phase("areas");
      assert.equal(
        await page.locator('[data-action="wh-add-area"]').count(),
        0,
      );
      await phase("operations");
      assert.equal(
        await page.locator('[data-action="wh-edit-task"]').count(),
        0,
      );
      await page.unroute("**/api/auth/me");
      await page.unroute(`**/api/dwh/warehouses/${warehouseId}`);
      await page.reload();
      await page.locator('[data-action="wh-settings"]').waitFor();
      const retainedProjectId = await page.evaluate(() => state.dwhProject.id);
      await page.locator('[data-action="wh-settings"]').click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator('[data-action="wh-remove"]').click();
      await page.locator('[data-action="wh-create"]').waitFor();
      await page
        .locator(`[data-action="dwh-open"][data-id="${retainedProjectId}"]`)
        .waitFor();
      const retained = await context.request.get(
        baseURL + `/api/dwh/projects/${retainedProjectId}`,
      );
      assert.equal(retained.status(), 200);
      assert.equal((await retained.json()).tables.length, 4);
      assert.equal(
        (
          await context.request.get(
            baseURL + `/api/dwh/warehouses/${warehouseId}`,
          )
        ).status(),
        404,
      );
      assert.deepEqual(errors, []);
      await context.close();
      console.log("Central warehouse UI passed: " + locale);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
