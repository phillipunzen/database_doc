// Real static assets with fictional API evidence; business writes are intercepted.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const baseURL = process.env.ASSESSMENT_TEST_URL;
if (!baseURL)
  throw Error("ASSESSMENT_TEST_URL must point to a disposable instance.");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const locale of ["de-DE", "en-US"]) {
      let role = "admin",
        empty = false;
      const errors = [],
        writes = [];
      const context = await browser.newContext({
          locale,
          viewport: { width: 1440, height: 1000 },
        }),
        page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      const source = (id, name, database) => ({
        id,
        name,
        kind: "postgresql",
        config: { host: "warehouse.example.invalid", port: 5432, database },
        tags: [],
        can_edit: role === "admin",
        can_data: false,
        snapshot_id: id,
        scanned_at: "2026-10-07T09:00:00",
        table_count: 80,
        column_count: 240,
        relation_count: 0,
        job: null,
      });
      const sources = () => [
        source(1, "ERP source", "erp"),
        source(2, "DWH <script>literal</script>", "warehouse"),
        source(3, "Reporting database", "reporting"),
      ];
      const table = {
        id: "fact",
        name: "fact_events",
        role: "fact",
        layer: "core",
        grain: "One event",
        description: "",
        load_mode: "full",
        load_strategy: "",
        status: "planned",
        columns: [
          {
            id: "id",
            name: "id",
            data_type: "bigint",
            nullable: false,
            primary_key: true,
            identity: true,
            purpose: "technical_key",
            mapping: null,
            transformation: "",
          },
        ],
        relations: [],
      };
      const project = () => ({
        id: 10,
        name: "Company DWH",
        goal: "Event analysis",
        warehouse_id: 20,
        target_kind: "postgresql",
        target_schema: "warehouse",
        target_source_id: empty ? null : 2,
        source_ids: [1],
        version: 1,
        can_edit: role === "admin",
        tables: [table],
        table_count: 1,
        issues: [],
        mapping_issues: [],
        implemented_count: 0,
      });
      const workspace = () => ({
        id: 20,
        project: project(),
        areas: [],
        tasks: [],
        comparison: null,
      });
      const summary = (s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        database: s.config.database,
        host: s.config.host,
        port: 5432,
        schema_filter: "",
        snapshot_id: s.id,
        scanned_at: s.scanned_at,
        can_scan: role === "admin",
        stale: false,
        table_count: 80,
        view_count: 1,
        object_count: 81,
        column_count: 240,
        relation_count: 0,
        warnings: [],
        job: null,
      });
      const report = () => ({
        project_id: 10,
        project_version: 1,
        generated_at: "2026-10-07T10:00:00",
        target: empty ? null : summary(sources()[1]),
        server_databases: empty ? [] : sources().slice(1).map(summary),
        sources: [
          {
            ...summary(sources()[0]),
            changes: {
              before_snapshot_id: 1,
              before_created: "2026-10-06T09:00:00",
              added_tables: 1,
              removed_tables: 0,
              changed_tables: 2,
            },
          },
        ],
        target_objects: empty
          ? []
          : Array.from({ length: 80 }, (_, i) => ({
              key: JSON.stringify(["warehouse", "fact_" + i]),
              schema: "warehouse",
              name: "fact_" + i,
              kind: "table",
              column_count: 3,
              relation_count: 0,
              planned: i === 0,
            })),
        comparison: empty ? null : { matched: 0, total: 1 },
        findings: empty
          ? [
              {
                code: "target_missing",
                severity: "warning",
                message: "Fictional target missing",
                action: "settings",
              },
            ]
          : Array.from({ length: 60 }, (_, i) => ({
              code: "target_difference",
              severity: i % 2 ? "info" : "warning",
              message: `Fictional finding ${i} <script>literal</script>`,
              action: i === 1 ? "mapping" : "source",
              source_id: 2,
              table_id: "fact",
            })),
        finding_counts: { warning: empty ? 1 : 30, info: empty ? 0 : 30 },
        omitted_findings: 0,
        limitations:
          "Fictional evidence: schema scans only; no data quality claim.",
      });
      await page.route("**/api/**", async (route) => {
        const req = route.request(),
          url = new URL(req.url());
        if (url.pathname === "/api/i18n/en.js") return route.continue();
        if (req.method() !== "GET") {
          writes.push({ path: url.pathname, body: req.postDataJSON() });
          if (url.pathname.endsWith("/scan"))
            return route.fulfill({
              status: 202,
              json: { id: 99, status: "queued" },
            });
          return route.fulfill({
            status: 400,
            json: { detail: "Unexpected fixture write" },
          });
        }
        let json = [];
        if (url.pathname === "/api/auth/me")
          json = {
            user: {
              id: 1,
              username: "fixture",
              display_name: "Fixture",
              role,
              provider: "local",
            },
            csrf: "fixture",
          };
        else if (url.pathname === "/api/branding") json = { logo_url: null };
        else if (url.pathname === "/api/sources") json = sources();
        else if (url.pathname === "/api/dwh/warehouses/20") json = workspace();
        else if (url.pathname === "/api/dwh/projects/10") json = project();
        else if (url.pathname === "/api/dwh/warehouses") json = [workspace()];
        else if (url.pathname === "/api/dwh/projects") json = [project()];
        else if (url.pathname.endsWith("/assessment")) json = report();
        else if (url.pathname.endsWith("/snapshot"))
          json = {
            id: 2,
            created: "2026-10-07T09:00:00",
            payload: {
              tables: [
                {
                  key: JSON.stringify(["warehouse", "fact_0"]),
                  schema: "warehouse",
                  name: "fact_0",
                  kind: "table",
                  columns: [],
                  primary_key: [],
                  foreign_keys: [],
                  indexes: [],
                  unique_constraints: [],
                },
              ],
              warnings: [],
            },
            notes: {},
          };
        else if (url.pathname.endsWith("/history"))
          json = [
            { id: 2, created: "2026-10-07T09:00:00", table_count: 1 },
            { id: 1, created: "2026-10-06T09:00:00", table_count: 1 },
          ];
        await route.fulfill({ json });
      });
      await page.goto(baseURL + "/#warehouse-workspace/20?phase=assessment");
      await page.locator('[data-action="wa-load"]').waitFor();
      await page.locator('[data-action="wa-load"]').click();
      await page.locator("#wa-findings .wa-finding").first().waitFor();
      assert.equal(await page.locator("#wa-findings .wa-finding").count(), 10);
      assert.equal(await page.locator("#wa-objects tbody tr").count(), 25);
      assert.equal(await page.locator(".content script").count(), 0);
      assert.equal(
        await page
          .locator('button[data-action="wa-source"][data-id="3"]')
          .count(),
        1,
      );
      await page
        .locator(
          '[data-action="wa-page"][data-id="finding"][data-direction="1"]',
        )
        .click();
      assert.equal(await page.locator("#wa-findings .wa-finding").count(), 10);
      await page.locator("#wa-severity").selectOption("warning");
      assert.equal(await page.locator("#wa-findings .wa-finding").count(), 10);
      assert(
        (await page.locator("#wa-findings").textContent()).includes(
          "Fictional finding 0",
        ),
      );
      await page.locator("#wa-object-query").fill("fact_79");
      assert.equal(await page.locator("#wa-objects tbody tr").count(), 1);
      await page.locator("#wa-object-query").fill("");
      await page
        .locator(
          '[data-action="wa-page"][data-id="object"][data-direction="1"]',
        )
        .click();
      assert.match(
        await page.locator("#wa-objects tbody tr").first().textContent(),
        /fact_25/,
      );
      await page.locator('[data-action="wa-task"]').first().click();
      assert.match(
        await page.locator('#wh-task-form [name="title"]').inputValue(),
        /Fictional finding/,
      );
      assert.match(
        await page.locator('#wh-task-form [name="notes"]').inputValue(),
        /version|Projektversion/,
      );
      await page.locator('[data-action="close-modal"]').first().click();
      assert.deepEqual(writes, []);
      await page.locator('[data-action="wa-settings"]').click();
      await page.locator("#dwh-target-source").waitFor();
      assert.equal(await page.locator("#dwh-target-source").inputValue(), "2");
      await page.locator('[data-action="close-modal"]').first().click();
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      if (locale === "en-US")
        await page.screenshot({
          path: "docs/warehouse-assessment-mobile.png",
          fullPage: false,
        });
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (locale === "en-US")
        await page.screenshot({
          path: "docs/warehouse-assessment.png",
          fullPage: true,
        });
      await page.locator('[data-action="wa-er"]').click();
      await page.locator("#er-svg").waitFor();
      assert.equal(await page.evaluate(() => state.source.id), 2);
      await page.locator('[data-action="wh-return"]').click();
      await page.locator('[data-action="wa-load"]').waitFor();
      await page.locator('[data-action="wa-load"]').click();
      await page.locator("#wa-findings").waitFor();
      page.once("dialog", (d) => d.dismiss());
      await page.locator('[data-action="wa-scan"]').first().click();
      assert.deepEqual(writes, []);
      page.once("dialog", (d) => d.accept());
      await page.locator('[data-action="wa-scan"]').first().click();
      await page.waitForFunction(
        () => !document.querySelector('[data-action="wa-load"]').disabled,
      );
      assert.equal(writes.length, 1);
      assert.equal(writes[0].path, "/api/sources/2/scan");
      writes.length = 0;
      await page.goto(baseURL + "/#warehouse-project/10?step=check");
      await page.locator('[data-action="wa-load"]').click();
      await page.locator("#wa-findings .wa-finding").first().waitFor();
      assert.equal(await page.locator("#wa-findings .wa-finding").count(), 10);
      empty = true;
      await page.locator('[data-action="wa-load"]').click();
      await page.waitForFunction(() => state.dwhAssessment.target === null);
      assert.equal(
        await page.locator('.wa-server [data-action="wa-scan"]').count(),
        0,
      );
      assert.equal(await page.locator("#wa-objects").count(), 0);
      role = "viewer";
      empty = false;
      await page.goto(baseURL + "/#warehouse-workspace/20?phase=assessment");
      await page.reload();
      await page.locator('[data-action="wa-load"]').click();
      await page.locator("#wa-findings .wa-finding").first().waitFor();
      assert.equal(
        await page
          .locator(
            '[data-action="wa-scan"],[data-action="wa-task"],[data-action="wa-settings"]',
          )
          .count(),
        0,
      );
      assert.equal(await page.locator('[data-action="wa-er"]').count(), 1);
      empty = true;
      await page.locator('[data-action="wa-load"]').click();
      await page.waitForFunction(() => state.dwhAssessment.target === null);
      assert.equal(await page.locator('[data-action="wa-hint"]').count(), 0);
      assert.deepEqual(writes, []);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        "Warehouse inventory, findings and object pagination, task preview, target binding, scan consent, source return, standalone/viewer access and mobile passed: " +
          locale,
      );
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
