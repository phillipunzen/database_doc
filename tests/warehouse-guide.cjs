// Real UI with fictional, read-only APIs; never write to a running installation.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const baseURL = process.env.GUIDE_TEST_URL;
if (!baseURL)
  throw new Error("GUIDE_TEST_URL must point to an isolated instance.");
const column = (name, primary = false, purpose = "attribute") => ({
  id: name,
  name,
  data_type: "bigint",
  nullable: false,
  primary_key: primary,
  identity: primary,
  purpose,
  mapping: null,
  transformation: primary ? "" : "Documented derivation from source data",
  description: "",
});
const tables = [
  {
    id: "machine",
    name: "dim_machine",
    role: "dimension",
    layer: "core",
    grain: "One row per machine",
    columns: [
      column("id", true, "technical_key"),
      column("machine_code", false, "business_key"),
    ],
    relations: [],
  },
  {
    id: "event",
    name: "fact_machine_events",
    role: "fact",
    layer: "core",
    grain: "One row per machine event",
    columns: [
      column("id", true, "technical_key"),
      column("machine_id", false, "foreign_key"),
      column("idle_minutes", false, "measure"),
    ],
    relations: [
      {
        id: "fk1",
        target_table_id: "machine",
        columns: ["machine_id"],
        target_columns: ["id"],
      },
    ],
  },
].map((table) => ({
  ...table,
  description: "Fictional model",
  load_mode: "incremental",
  load_strategy: "Daily load using event timestamps; retry failed batches",
  status: "planned",
}));
const sources = [1, 2].map((id) => ({
  id,
  name: id === 1 ? "Machine control" : "Actual warehouse",
  kind: "postgresql",
  config: {
    database: id === 1 ? "application" : "warehouse",
    host: "db.example.invalid",
  },
  can_edit: true,
  can_data: false,
  snapshot_id: id,
  table_count: 2,
  column_count: 5,
  relation_count: 1,
  scanned_at: "2026-10-07T10:00:00",
}));
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const locale of ["de-DE", "en-US"]) {
      let mode = "plan",
        role = "admin",
        legacy = false;
      const project = () => ({
        id: 10,
        warehouse_id: 20,
        name: "Company warehouse",
        goal: "Machine downtime and maintenance by day",
        target_kind: "postgresql",
        target_schema: "warehouse",
        target_source_id: 2,
        source_ids: [1],
        version: 1,
        can_edit: role === "admin",
        table_count: 2,
        implemented_count: mode === "plan" ? 0 : 2,
        issues: [],
        mapping_issues: [],
        tables: tables.map((table) => ({
          ...table,
          status: mode === "plan" ? "planned" : "implemented",
        })),
      });
      const workspace = () => ({
        id: 20,
        project: project(),
        areas: [
          {
            id: "production",
            name: "Machine data",
            department: "Production",
            owner: "Production team",
            goal: "Daily idle minutes",
            table_ids: ["machine", "event"],
          },
          {
            id: "maintenance",
            name: "Maintenance analysis",
            department: "Maintenance <script>literal</script>",
            owner: "Maintenance team",
            goal: "Events by machine",
            table_ids: ["machine", "event"],
          },
          ...(legacy
            ? [
                {
                  id: "legacy",
                  name: "Older draft",
                  owner: "",
                  goal: "Existing plan",
                  table_ids: ["event"],
                },
              ]
            : []),
        ],
        tasks: [
          {
            id: "sql",
            kind: "implementation",
            title: "Review and run SQL",
            owner: "Platform team",
            status: mode === "complete" ? "done" : "open",
            notes: "Documented outcome",
            due_date: null,
            area_id: null,
          },
          {
            id: "etl",
            kind: "implementation",
            title: "Implement load jobs",
            owner: "Platform team",
            status: mode === "complete" ? "done" : "open",
            notes: "Documented outcome",
            due_date: null,
            area_id: null,
          },
          {
            id: "quality",
            kind: "quality",
            title: "Reconcile idle minutes",
            owner: "Production team",
            status: mode === "complete" ? "done" : "open",
            notes: "Matched application totals",
            due_date: null,
            area_id: "production",
          },
          {
            id: "ops",
            kind: "operations",
            title: "Check load freshness",
            owner: "Operations",
            status: "open",
            notes: "",
            due_date: "2026-10-08",
            area_id: null,
          },
          {
            id: "maintenance_check",
            kind: "operations",
            title: "Maintenance review",
            owner: "Maintenance team",
            status: "open",
            notes: "",
            due_date: "2026-10-08",
            area_id: "maintenance",
          },
        ],
        comparison: {
          matched: 2,
          total: 2,
          snapshot_id: 2,
          created: "2026-10-07T10:00:00",
          tables: tables.map((table) => ({
            table_id: table.id,
            table_name: table.name,
            matches: true,
            issues: [],
            extra_columns: [],
          })),
          extra_tables: [],
        },
      });
      const context = await browser.newContext({
        locale,
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/**", (route) => {
        const url = new URL(route.request().url());
        if (
          ["/api/i18n/en.js", "/api/i18n/preference.js"].includes(url.pathname)
        )
          return route.continue();
        assert.equal(
          route.request().method(),
          url.pathname === "/api/finder/candidates" ? "POST" : "GET",
          "Guide and filters must not write business data",
        );
        let result = [];
        if (url.pathname === "/api/auth/me")
          result = {
            user: {
              id: 1,
              username: "fixture",
              display_name: "Guide test",
              role,
              provider: "local",
            },
            csrf: "fixture",
          };
        else if (url.pathname === "/api/finder/candidates")
          result = {
            candidates: [],
            recognized_terms: [],
            total: 0,
            page: 1,
            page_size: 10,
            unscanned_sources: 0,
          };
        else if (url.pathname === "/api/branding") result = { logo_url: null };
        else if (url.pathname === "/api/sources") result = sources;
        else if (url.pathname === "/api/dwh/warehouses") result = [workspace()];
        else if (url.pathname === "/api/dwh/warehouses/20")
          result = workspace();
        else if (url.pathname === "/api/dwh/projects/10") result = project();
        else if (url.pathname.endsWith("/snapshot"))
          result = { id: 1, payload: { tables: [], warnings: [] }, notes: {} };
        return route.fulfill({ json: result });
      });
      await page.goto(baseURL + "/#warehouse");
      await page.locator(".wh-recommended").waitFor();
      assert.equal(await page.locator("h1").textContent(), "Data Warehouse");
      assert.equal(await page.locator(".wh-architecture > div").count(), 3);
      assert.equal(await page.locator('[data-action="wh-create"]').count(), 1);
      assert.equal(await page.locator(".wh-build-guide").count(), 0);
      assert.equal(
        await page.locator(".wh-standalone").getAttribute("open"),
        null,
      );
      await page.locator(".wh-standalone > summary").click();
      assert(await page.locator('[data-action="dwh-create"]').isVisible());
      assert.match(
        await page.locator(".wh-standalone").textContent(),
        locale === "de-DE" ? /Prototyp/ : /prototype/,
      );
      if (locale === "en-US") {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/warehouse-hub.png"),
          fullPage: true,
        });
      }
      await page.locator('.wh-warehouse-list [data-action="wh-open"]').click();
      await page.locator("#wh-view").waitFor();
      const badge = (id) =>
        page.locator(`.wh-guide-nav-step[data-id="${id}"] small`);
      assert.equal(
        await badge("implementation").textContent(),
        locale === "de-DE" ? "Ausstehend" : "Pending",
      );
      assert.notEqual(await badge("validation").textContent(), "Documented");
      assert.equal(
        await page
          .locator('.wh-guide-current[data-guide-step="implementation"]')
          .count(),
        1,
      );
      assert.equal(await page.locator(".wh-guide-current").count(), 1);
      await page.locator('.wh-guide-nav-step[data-id="sources"]').click();
      assert.equal(
        await page
          .locator('.wh-guide-current[data-guide-step="sources"]')
          .count(),
        1,
      );
      await page.reload();
      await page
        .locator('.wh-guide-current[data-guide-step="sources"]')
        .waitFor();
      await page
        .locator('.wh-guide-nav-step[data-id="implementation"]')
        .click();
      const statuses = () =>
        page.evaluate(() =>
          Object.fromEntries(
            whBuildSteps(state.wh).map((step) => [step.id, step.done]),
          ),
        );
      assert.equal((await statuses()).implementation, false);
      assert.equal(
        (await statuses()).validation,
        false,
        "Matching schema alone must not complete data validation",
      );
      mode = "reported";
      await page.locator('[data-action="wh-reload"]').click();
      await page.waitForFunction(
        () => state.dwhProject.implemented_count === 2,
      );
      assert.equal(
        (await statuses()).implementation,
        false,
        "Reported table status is not evidence of completed load jobs",
      );
      mode = "complete";
      await page.locator('[data-action="wh-reload"]').click();
      await page.waitForFunction(() => state.wh.tasks[0].status === "done");
      assert(Object.values(await statuses()).every(Boolean));
      legacy = true;
      await page.locator('[data-action="wh-reload"]').click();
      await page.waitForFunction(() => state.wh.areas.length === 3);
      assert.equal(
        (await statuses()).subjects,
        false,
        "An old subject without department/owner still needs assignment",
      );
      const phase = async (tab) => {
        if (
          tab !== "overview" &&
          (await page.locator(".wh-view-menu details").getAttribute("open")) ===
            null
        )
          await page.locator(".wh-view-menu summary").click();
        await page.locator(`[data-action="wh-tab"][data-tab="${tab}"]`).click();
      };
      await phase("areas");
      await page
        .locator("#wh-department-filter")
        .selectOption("dept:production");
      assert.equal(await page.locator(".wh-card-grid article").count(), 1);
      assert.match(
        await page.locator(".wh-card-grid article").textContent(),
        /Production team/,
      );
      await phase("model");
      assert.equal(await page.locator(".dwh-diagram-node").count(), 2);
      assert.equal(
        await page.locator('.dwh-diagram-node[data-id="machine"]').count(),
        1,
      );
      await page
        .locator("#wh-department-filter")
        .selectOption("dept:maintenance <script>literal</script>");
      assert.equal(
        await page.locator('.dwh-diagram-node[data-id="machine"]').count(),
        1,
      );
      assert.equal(await page.locator(".wh-filters script").count(), 0);
      await page.locator("#wh-query").fill("idle_minutes");
      assert.equal(await page.locator(".dwh-diagram-node").count(), 1);
      assert.equal(await page.locator(".diagram-minimap").count(), 1);
      assert.equal(await page.evaluate(() => diagramControllers.size), 1);
      await page.locator("#wh-query").fill("no matching table");
      assert.equal(await page.locator(".diagram-minimap").count(), 0);
      assert.equal(await page.evaluate(() => diagramControllers.size), 0);
      await page.locator("#wh-query").fill("");
      await phase("operations");
      assert.equal(
        await page.locator("#wh-view tbody tr").count(),
        4,
        "Global tasks and selected department tasks must remain visible",
      );
      await page
        .locator("#wh-department-filter")
        .selectOption("dept:production");
      assert.equal(await page.locator("#wh-view tbody tr").count(), 4);
      await phase("areas");
      await page.locator("#wh-department-filter").selectOption("unset");
      assert.equal(await page.locator(".wh-card-grid article").count(), 1);
      assert.match(
        await page.locator(".wh-card-grid article").textContent(),
        /Older draft/,
      );
      await phase("model");
      assert.equal(await page.locator(".dwh-diagram-node").count(), 1);
      assert.equal(await page.locator("[data-edge-source]").count(), 0);
      await page.locator("#wh-department-filter").selectOption("");
      await page
        .locator('button[data-action="wh-table"][data-id="machine"]')
        .click();
      await page.locator(".wh-editor-context").waitFor();
      assert.match(
        await page.locator(".wh-editor-context").textContent(),
        locale === "de-DE" ? /gemeinsame Zielmodell/ : /shared target model/,
      );
      await page.locator('[data-action="wh-return"]').click();
      await page.locator(".wh-build-guide").waitFor();
      await page.locator('.wh-guide-nav-step[data-id="sources"]').click();
      await page
        .locator('[data-guide-step="sources"] [data-action="wh-input-source"]')
        .click();
      await page.locator('[data-action="wh-return"]').waitFor();
      await page.locator('[data-action="wh-return"]').click();
      await page.locator("#wh-view").waitFor();
      role = "viewer";
      await page.reload();
      await page.locator(".wh-build-guide").waitFor();
      assert.equal(
        await page
          .locator('[data-action="wh-settings"]:not([disabled])')
          .count(),
        0,
      );
      await phase("areas");
      assert.equal(
        await page
          .locator('[data-action="wh-add-area"]:not([disabled])')
          .count(),
        0,
      );
      await page
        .locator("#wh-department-filter")
        .selectOption("dept:production");
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await phase("overview");
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      if (locale === "en-US")
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/warehouse-guide-mobile.png"),
          fullPage: true,
        });
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        `Warehouse guide passed: ${locale}, hierarchy, seven steps, honest progress, departments, shared dimensions, legacy subjects, search lifecycle, task scope, viewer, mobile`,
      );
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
