// Exercise new feature UI against mocked API responses; never write live records.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const projectRoot = path.resolve(__dirname, "..");
const baseURL =
  process.env.APP_URL ||
  fs
    .readFileSync(path.join(projectRoot, ".env"), "utf8")
    .match(/^APP_URL=(.*)$/m)?.[1] ||
  "http://localhost:8090";
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      locale: "de-DE",
      viewport: { width: 1440, height: 1100 },
    });
    const errors = [],
      writes = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let role = "admin";
    let snapshotTables = null,
      snapshotId = 3;
    const schedule = {
      enabled: false,
      cadence: "daily",
      hour: 2,
      minute: 0,
      weekday: 0,
      timezone: "Europe/Berlin",
      next_run: null,
      last_started: null,
      message: "",
    };
    const sources = [1, 2].map((id) => ({
      id,
      name: id === 1 ? "Sales Warehouse" : "Marketing DB",
      kind: "postgresql",
      config: { host: "db.example.invalid", database: "warehouse" },
      tags: id === 1 ? ["Production", "Finance"] : ["Development"],
      owner: id === 1 ? "Data Platform" : "Marketing Team",
      owner_email: "data@example.org",
      can_edit: true,
      can_data: false,
      snapshot_id: 3,
      scanned_at: "2026-10-06T08:00:00",
      table_count: 1,
      column_count: 2,
      relation_count: 0,
      job: null,
      schedule: { ...schedule },
    }));
    const table = {
      key: '["public","customers"]',
      schema: "public",
      name: "customers",
      kind: "table",
      comment: "Customer dimension",
      columns: [
        {
          name: "id",
          type: "INTEGER",
          nullable: false,
          default: null,
          primary_key: true,
        },
        {
          name: "customer_email",
          type: "TEXT",
          nullable: true,
          default: null,
          primary_key: false,
        },
      ],
      primary_key: ["id"],
      foreign_keys: [],
      indexes: [],
      unique_constraints: [],
    };
    await page.route("**/static/app.js", (r) =>
      r.fulfill({
        path: path.join(projectRoot, "app/static/app.js"),
        contentType: "application/javascript",
      }),
    );
    await page.route("**/static/style.css", (r) =>
      r.fulfill({
        path: path.join(projectRoot, "app/static/style.css"),
        contentType: "text/css",
      }),
    );
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        method = req.method(),
        body = method === "GET" ? null : req.postDataJSON();
      if (url.pathname === "/api/i18n/en.js") return route.continue();
      if (method !== "GET") writes.push({ path: url.pathname, body });
      let json;
      if (url.pathname === "/api/auth/me")
        json = {
          user: {
            id: 1,
            username: "fixture",
            display_name: "UI Test",
            role,
            provider: "local",
          },
          csrf: "fixture",
        };
      else if (url.pathname === "/api/sources") json = sources;
      else if (url.pathname.endsWith("/metadata") && method === "PUT") {
        Object.assign(sources[0], body);
        json = body;
      } else if (url.pathname.endsWith("/schedule")) {
        if (method === "PUT") {
          Object.assign(schedule, body, {
            next_run: body.enabled ? "2026-10-07T04:30:00" : null,
            message: body.enabled
              ? "Zeitplan aktiv."
              : "Automatische Scans deaktiviert.",
          });
          sources[0].schedule = { ...schedule };
        }
        json = url.pathname.includes("/2/")
          ? { ...schedule, enabled: false, timezone: "UTC", hour: 5 }
          : schedule;
      } else if (url.pathname.endsWith("/history"))
        json = [3, 2, 1].map((id) => ({
          id,
          created: `2026-10-0${id}T08:00:00`,
          table_count: 1,
        }));
      else if (url.pathname.endsWith("/snapshot"))
        json = {
          id: snapshotId,
          created: "2026-10-06T08:00:00",
          payload: { tables: snapshotTables || [table], warnings: [] },
          notes: { [table.key]: "Glossary <script>alert(1)</script>" },
        };
      else if (url.pathname.endsWith("/compare")) {
        const before = Number(url.searchParams.get("before")),
          after = Number(url.searchParams.get("after"));
        if (before >= after)
          return route.fulfill({
            status: 422,
            json: {
              detail:
                "Der Ausgangsstand muss älter als der Vergleichsstand sein.",
            },
          });
        json = {
          before: { id: before },
          after: { id: after },
          added_tables: [],
          removed_tables: [],
          changed_tables: [
            {
              ...table,
              added_columns: [table.columns[1]],
              removed_columns: [],
              changed_columns: [
                {
                  name: "id",
                  changes: { type: { before: "INT", after: "BIGINT" } },
                },
              ],
              changes: {
                indexes: {
                  before: [],
                  after: [
                    {
                      name: "ix_email",
                      columns: ["customer_email"],
                      unique: true,
                    },
                  ],
                },
              },
            },
          ],
          summary: {
            added_tables: 0,
            removed_tables: 0,
            changed_tables: 1,
            added_columns: 1,
            removed_columns: 0,
            changed_columns: 1,
          },
          inferred: false,
        };
      } else if (url.pathname.endsWith("/notes") && method === "PUT") {
        json = { ok: true };
      } else if (url.pathname === "/api/search") {
        const note = url.searchParams.get("kind") === "note";
        json = {
          total: 1,
          page: 1,
          page_size: 50,
          results: [
            {
              source_id: 1,
              source_name: sources[0].name,
              source_kind: "postgresql",
              kind: note ? "note" : "column",
              table_key: table.key,
              table_name: "public.customers",
              column_name: note ? null : "customer_email",
              title: note
                ? "public.customers"
                : "public.customers.customer_email",
              snippet: "Glossary <script>alert(1)</script>",
            },
          ],
        };
      } else
        throw new Error(
          "Unexpected API request " + method + " " + url.pathname,
        );
      return route.fulfill({ json });
    });
    await page.goto(baseURL + "/#sources");
    await page.locator("#source-tag-filter").selectOption("Finance");
    assert.equal(await page.locator(".source-list tbody tr").count(), 1);
    await page.locator("#source-search").fill("Data Platform");
    assert.equal(await page.locator(".source-list tbody tr").count(), 1);
    await page.locator('[data-action="open"][data-id="1"]').first().click();
    await page
      .locator('[data-action="source-tab"][data-tab="organization"]')
      .click();
    await page.locator("#source-tags").fill("Production, Finance, Core");
    await page.locator("#source-owner").fill("Warehouse Team");
    await page.getByRole("button", { name: "Zuständigkeit speichern" }).click();
    await page.waitForFunction(
      () => document.querySelector("#source-owner")?.value === "Warehouse Team",
    );
    assert.deepEqual(writes.at(-1).body.tags, [
      "Production",
      "Finance",
      "Core",
    ]);
    await page
      .locator('[data-action="source-tab"][data-tab="schedule"]')
      .click();
    await page.locator('[name="enabled"]').check();
    await page.locator("#schedule-cadence").selectOption("weekly");
    await page.locator("#schedule-time").fill("06:30");
    await page.locator("#schedule-weekday").selectOption("2");
    await page.getByRole("button", { name: "Zeitplan speichern" }).click();
    await page.getByText("Zeitplan aktiv.", { exact: true }).waitFor();
    assert.deepEqual(writes.at(-1).body, {
      enabled: true,
      cadence: "weekly",
      hour: 6,
      minute: 30,
      weekday: 2,
      timezone: "Europe/Berlin",
    });
    await page.screenshot({
      path: path.join(projectRoot, "docs/automatic-scans.png"),
      fullPage: true,
    });
    await page
      .locator('[data-action="source-tab"][data-tab="compare"]')
      .click();
    await page.getByText("Spalte id", { exact: true }).waitFor();
    assert.equal(await page.getByText("BIGINT", { exact: true }).count(), 1);
    await page.locator("#compare-before").selectOption("1");
    await page
      .getByRole("button", { name: "Vergleichen", exact: true })
      .click();
    await page.getByText("Spalte id", { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(projectRoot, "docs/schema-comparison.png"),
      fullPage: true,
    });
    await page.locator("#compare-before").selectOption("3");
    await page.locator("#compare-after").selectOption("1");
    await page
      .getByRole("button", { name: "Vergleichen", exact: true })
      .click();
    await page.getByRole("alert").filter({ hasText: "älter" }).waitFor();
    await page.locator('[data-action="nav"][data-view="search"]').click();
    await page.locator("#global-search-q").fill("customer");
    await page.getByRole("button", { name: "Suchen", exact: true }).click();
    await page.locator(".search-result").waitFor();
    assert.equal(await page.locator(".search-result script").count(), 0);
    await page.screenshot({
      path: path.join(projectRoot, "docs/global-search.png"),
      fullPage: true,
    });
    await page.locator('[data-action="search-open"]').first().click();
    await page.locator(".search-highlight").waitFor();
    assert.match(
      await page.locator(".search-highlight").textContent(),
      /customer_email/,
    );
    await page.reload();
    await page.locator(".search-highlight").waitFor();
    await page.goBack();
    await page.locator("#global-search-kind").selectOption("note");
    await page.getByRole("button", { name: "Suchen", exact: true }).click();
    await page.locator('[data-action="search-open"]').first().click();
    await page.locator("#note").waitFor();
    assert.match(await page.locator("#note").inputValue(), /Glossary <script>/);
    // An automatic scan inserts a table before the object being documented.
    // Refreshing in the background must not attach an unfinished note to that new table.
    await page.locator("#note").fill("Unfinished note for customers");
    await page.locator("#note").blur();
    sources[0].job = {
      id: 99,
      status: "completed",
      message: "Fixture automatic scan",
    };
    sources[0].snapshot_id = 4;
    snapshotId = 4;
    snapshotTables = [
      { ...table, key: '["public","added_first"]', name: "added_first" },
      table,
    ];
    await page.waitForTimeout(33000);
    assert.equal(
      await page.locator("#note").inputValue(),
      "Unfinished note for customers",
    );
    await page
      .getByRole("button", { name: "Dokumentation speichern", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.getElementById("toast").textContent ===
        "Dokumentation gespeichert.",
    );
    assert.equal(writes.at(-1).body.table_key, table.key);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .locator('[data-action="source-tab"][data-tab="schedule"]')
      .click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Mobile schedule overflow",
    );
    await page
      .locator('[data-action="source-tab"][data-tab="compare"]')
      .click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      "Mobile diff overflow",
    );
    await page.screenshot({
      path: path.join(projectRoot, "docs/schema-comparison-mobile.png"),
      fullPage: true,
    });
    role = "viewer";
    sources.forEach((s) => (s.can_edit = false));
    await page.goto(baseURL + "/#source/2");
    await page.reload();
    await page
      .getByRole("heading", { name: "Marketing DB", exact: true })
      .waitFor();
    await page
      .locator('[data-action="source-tab"][data-tab="organization"]')
      .click();
    assert.ok(await page.locator("#source-owner").isDisabled());
    await page
      .locator('[data-action="source-tab"][data-tab="schedule"]')
      .click();
    assert.ok(await page.locator("#schedule-cadence").isDisabled());
    assert.equal(await page.locator("#schedule-timezone").inputValue(), "UTC");
    assert.deepEqual(errors, []);
    console.log(
      "Feature browser checks passed: tags, owner, schedules, comparisons, global search, deep links, read-only roles and mobile layout. Screenshots show simulated fixtures.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
