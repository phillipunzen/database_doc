// Guided process against mocked business APIs on an isolated test instance.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const baseURL = process.env.WAREHOUSE_TEST_URL;
if (!baseURL)
  throw new Error(
    "WAREHOUSE_TEST_URL must point to an isolated test instance.",
  );
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const locale of ["de-DE", "en-US"]) {
      let role = "admin",
        project = null,
        creates = 0,
        writes = 0,
        compareFails = false;
      const sources = [
        {
          id: 1,
          name: "Sales source",
          kind: "postgresql",
          config: { host: "db.example.invalid", database: "sales" },
          can_edit: true,
          can_data: false,
          snapshot_id: null,
          table_count: 2,
          column_count: 4,
          relation_count: 1,
        },
        {
          id: 2,
          name: "Warehouse target",
          kind: "postgresql",
          config: { host: "dwh.example.invalid", database: "warehouse" },
          can_edit: true,
          can_data: false,
          snapshot_id: 2,
          table_count: 1,
          column_count: 2,
          relation_count: 0,
        },
      ];
      const context = await browser.newContext({
        locale,
        viewport: { width: 1440, height: 1000 },
        acceptDownloads: true,
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const detail = () => ({
        ...project,
        can_edit: role === "admin",
        table_count: project.tables.length,
        implemented_count: project.tables.filter((t) =>
          ["implemented", "accepted"].includes(t.status),
        ).length,
        issues: [],
        mapping_issues: project.mapping_issues || [],
      });
      await page.route("**/api/**", (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          method = request.method();
        if (url.pathname === "/api/i18n/en.js") return route.continue();
        if (method !== "GET") {
          assert.equal(role, "admin");
          writes++;
        }
        let result;
        if (url.pathname === "/api/branding") result = { logo_url: null };
        else if (url.pathname === "/api/auth/me")
          result = {
            user: {
              id: 1,
              username: "fixture",
              display_name: "Workflow test",
              role,
              provider: "local",
            },
            csrf: "fixture",
          };
        else if (url.pathname === "/api/sources")
          result = sources.map((s) => ({ ...s, can_edit: role === "admin" }));
        else if (url.pathname === "/api/dwh/projects" && method === "POST") {
          creates++;
          project = {
            ...request.postDataJSON(),
            id: 10,
            version: 1,
            mapping_issues: [],
          };
          result = detail();
        } else if (url.pathname === "/api/dwh/projects")
          result = project ? [detail()] : [];
        else if (url.pathname === "/api/dwh/projects/10/export")
          return route.fulfill({
            body: "-- Fictional fixture\nCREATE TABLE warehouse.dim_customer (id BIGINT);",
            contentType: "application/sql",
          });
        else if (
          url.pathname === "/api/dwh/projects/10/compare" &&
          compareFails
        )
          return route.fulfill({
            status: 503,
            json: { detail: "Comparison unavailable" },
          });
        else if (url.pathname === "/api/dwh/projects/10/compare")
          result = {
            total: project.tables.length,
            matched: project.tables.length,
            snapshot_id: sources[1].snapshot_id,
            created: "2026-10-07T10:00:00Z",
            tables: project.tables.map((t) => ({
              table_id: t.id,
              table_name: t.name,
              matches: true,
              issues: [],
              extra_columns: [],
            })),
            extra_tables: [],
            limitations: "Stored schema comparison only.",
          };
        else if (url.pathname === "/api/dwh/projects/10") {
          if (method === "PUT") {
            const body = request.postDataJSON();
            assert.equal(body.version, project.version);
            project = {
              ...body,
              id: 10,
              version: project.version + 1,
              mapping_issues: project.mapping_issues,
            };
          }
          result = detail();
        } else if (url.pathname.endsWith("/snapshot"))
          result = {
            id: 1,
            created: "2026-10-07T10:00:00Z",
            payload: { tables: [], warnings: [] },
            notes: {},
          };
        else
          throw new Error(
            "Unexpected fixture request: " + method + " " + url.pathname,
          );
        return route.fulfill({ json: result });
      });
      await page.goto(baseURL + "/#warehouse");
      await page.locator('[data-action="dwh-create"]').click();
      await page.locator('[data-action="dwh-wizard-next"]').click();
      assert.equal(
        await page
          .locator("#dwh-project-form")
          .getAttribute("data-wizard-step"),
        "0",
      );
      assert.equal(creates, 0);
      await page
        .locator('#dwh-project-form [name="name"]')
        .fill("Sales Warehouse · Example");
      await page
        .locator('#dwh-project-form [name="goal"]')
        .fill("Daily net revenue by customer.");
      if (locale === "en-US")
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/dwh-guided-setup.png"),
          fullPage: true,
        });
      await page.locator('[data-action="dwh-wizard-next"]').click();
      await page.locator("#dwh-target_kind").selectOption("postgresql");
      await page.locator("#f-target_schema").fill("warehouse");
      await page.locator('[data-action="dwh-wizard-back"]').click();
      assert.equal(
        await page.locator('[name="goal"]').inputValue(),
        "Daily net revenue by customer.",
      );
      await page.locator('[data-action="dwh-wizard-next"]').click();
      await page.locator('[data-action="dwh-wizard-next"]').click();
      await page.locator("#dwh-source-ids").selectOption("1");
      assert.equal(creates, 0);
      await page.locator('#dwh-project-form [type="submit"]').click();
      await page.locator(".dwh-process").waitFor();
      assert.equal(creates, 1);
      assert.equal(project.target_schema, "warehouse");
      assert.equal(await page.locator(".content script").count(), 0);
      assert.equal(await page.locator(".dwh-step").count(), 5);
      assert.equal(
        await page
          .locator('.dwh-step[aria-current="step"]')
          .getAttribute("data-tab"),
        "overview",
      );
      await page.locator('.dwh-guide-next [data-work="source"]').click();
      await page.locator("#source-body").waitFor();
      assert.equal(await page.locator("h1").textContent(), "Sales source");
      // Simulate an externally completed source scan, without scanning a real database.
      sources[0].snapshot_id = 1;
      await page.locator('[data-action="dwh-return"]').click();
      await page.locator(".dwh-process").waitFor();
      assert(
        await page
          .locator('[data-tab="overview"]')
          .evaluate((node) => node.classList.contains("complete")),
      );
      assert(
        (await page.locator(".dwh-roadmap h2").textContent()).includes(
          locale === "de-DE" ? "Zielmodell" : "Target model",
        ),
      );
      await page.locator('.dwh-roadmap [data-work="model"]').click();
      await page.locator('.dwh-guide-next [data-work="add-table"]').click();
      await page.locator('#dwh-table-form [name="name"]').fill("dim_customer");
      await page.locator('[name="grain"]').fill("One row per customer");
      await page.locator('#dwh-table-form [type="submit"]').click();
      await page
        .getByRole("heading", { name: "dim_customer", exact: true })
        .waitFor();
      await page.locator('.dwh-guide-next [data-work="add-column"]').click();
      await page.locator("#dwh-column-form").waitFor();
      assert.equal(
        await page.locator('#dwh-column-form [name="name"]').inputValue(),
        "",
      );
      await page.locator('[data-action="close-modal"]').first().click();
      // Load a fully documented fictional model to exercise later workflow stages.
      project.tables[0] = {
        ...project.tables[0],
        load_mode: "full",
        load_strategy: "Daily replacement, followed by quality checks.",
        status: "planned",
        relations: [],
        columns: [
          {
            id: "c1",
            name: "id",
            data_type: "bigint",
            nullable: false,
            primary_key: true,
            identity: true,
            purpose: "technical_key",
            transformation: "",
            description: "",
            mapping: null,
          },
          {
            id: "c2",
            name: "customer_code",
            data_type: "varchar",
            length: 100,
            nullable: false,
            primary_key: false,
            identity: false,
            purpose: "business_key",
            transformation: "",
            description: "",
            mapping: {
              source_id: 1,
              snapshot_id: 1,
              table_key: '["public","customers"]',
              column_name: "code",
            },
          },
        ],
      };
      project.version++;
      await page.reload();
      await page.locator(".dwh-process").waitFor();
      assert.equal(
        await page
          .locator('.dwh-step[aria-current="step"]')
          .getAttribute("data-tab"),
        "model",
      );
      assert.equal(await page.locator(".dwh-step.complete").count(), 3);
      assert.equal(await page.locator(".dwh-guide").getAttribute("open"), null);
      await page
        .locator('[data-action="dwh-tab"][data-tab="overview"]')
        .click();
      if (locale === "en-US") {
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/dwh-workflow.png"),
          fullPage: true,
        });
      }
      await page
        .locator('[data-action="dwh-tab"][data-tab="progress"]')
        .click();
      assert(
        (await page.locator(".dwh-boundary").textContent()).includes(
          locale === "de-DE" ? "lädt keine Daten" : "or load data",
        ),
      );
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        page.locator('.dwh-guide [data-work="export"]').click(),
      ]);
      assert.equal(download.suggestedFilename(), "databasedoc-dwh-10.sql");
      await page.locator("[data-dwh-status]").selectOption("implemented");
      await page.locator(".dwh-step.complete").nth(3).waitFor();
      await page.locator('[data-action="dwh-tab"][data-tab="check"]').click();
      await page.locator('.dwh-guide-next [data-work="settings"]').click();
      await page.locator("#dwh-target-source").selectOption("2");
      await page.locator('#dwh-project-form [type="submit"]').click();
      await page.locator('.dwh-guide-next [data-work="compare"]').click();
      await page.locator(".dwh-step.complete").nth(4).waitFor();
      assert.equal(await page.locator(".dwh-step.complete").count(), 5);
      // A failed retry must invalidate the previous successful comparison.
      compareFails = true;
      await page.locator('[data-action="dwh-compare"]').click();
      await page.waitForFunction(
        () =>
          state.dwhComparing == null &&
          state.dwhComparison === null &&
          document.querySelectorAll(".dwh-step.complete").length === 4,
      );
      assert.equal(await page.locator(".dwh-step.complete").count(), 4);
      compareFails = false;
      await page.locator('.dwh-guide-next [data-work="compare"]').click();
      await page.locator(".dwh-step.complete").nth(4).waitFor();
      // Reloading retains the selected phase but requires a fresh target comparison.
      sources[1].snapshot_id = 3;
      await page.reload();
      await page.locator(".dwh-process").waitFor();
      assert.equal(await page.locator(".dwh-step.complete").count(), 4);
      assert.equal(
        await page
          .locator('.dwh-step[aria-current="step"]')
          .getAttribute("data-tab"),
        "check",
      );
      project.mapping_issues = [
        "dim_customer.customer_code: Quellfeld fehlt im aktuellen Scan.",
      ];
      await page.locator('[data-action="dwh-reload"]').click();
      await page.waitForFunction(
        () => document.querySelectorAll(".dwh-step.complete").length === 3,
      );
      assert.equal(await page.locator(".dwh-step.complete").count(), 3);
      role = "viewer";
      project.goal = "";
      await page.reload();
      await page.locator(".dwh-process").waitFor();
      await page
        .locator('[data-action="dwh-tab"][data-tab="overview"]')
        .click();
      assert.equal(
        await page.locator(".dwh-guide-next button").isDisabled(),
        true,
      );
      assert.equal(
        await page.locator('[data-action="dwh-settings"]').count(),
        0,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      const before = writes;
      await page
        .locator('[data-action="dwh-tab"][data-tab="progress"]')
        .click();
      assert.equal(await page.locator("[data-dwh-status]").isDisabled(), true);
      assert.equal(writes, before);
      assert.deepEqual(errors, []);
      await context.close();
      console.log("Guided DWH process passed: " + locale);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
