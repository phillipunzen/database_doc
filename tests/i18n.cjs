// Language UI checks against a disposable instance. All business APIs are mocked.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const baseURL = process.env.I18N_TEST_URL;
if (!baseURL)
  throw new Error("I18N_TEST_URL must point to an isolated test instance.");
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const locale of ["de-DE", "de-AT", "en-US", "en-GB", "fr-FR"]) {
      const german = locale.startsWith("de");
      const context = await browser.newContext({
        locale,
        viewport: { width: 1440, height: 1000 },
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(baseURL);
      await page.locator("#login-form").waitFor();
      assert.equal(
        await page.locator("html").getAttribute("lang"),
        german ? "de" : "en",
      );
      assert.equal(
        await page.locator('label[for="login-user"]').textContent(),
        german ? "Benutzername" : "Username",
      );
      assert.equal(
        await page.title(),
        german
          ? "DatabaseDoc · Datenbankdokumentation"
          : "DatabaseDoc · Database documentation",
      );
      const source = {
        id: 1,
        name: "Datenquellen",
        kind: "postgresql",
        config: { host: "db.example.invalid", database: "Beschreibung" },
        can_edit: true,
        can_data: false,
        snapshot_id: 1,
        table_count: 1,
        column_count: 1,
        relation_count: 0,
        scanned_at: "2026-10-06T10:00:00",
        tags: ["Bearbeiten"],
        owner: "Verantwortlich",
        job: { status: "completed", message: "1 Objekte dokumentiert." },
      };
      const table = {
        key: '["public","Datenquellen"]',
        name: "Datenquellen",
        schema: "public",
        kind: "table",
        comment: "Beschreibung & Fachwissen",
        columns: [
          {
            name: "Beschreibung",
            type: "TEXT",
            nullable: true,
            primary_key: false,
          },
        ],
        primary_key: [],
        foreign_keys: [],
        indexes: [],
        unique_constraints: [],
      };
      const project = {
        id: 1,
        name: "DWH Datenquellen",
        goal: "Konzeption & Umsetzung <script>literal</script>",
        target_kind: "postgresql",
        target_schema: "warehouse",
        source_ids: [1],
        target_source_id: 1,
        version: 1,
        can_edit: true,
        implemented_count: 0,
        table_count: 1,
        issues: ["Datenquellen: Granularität fehlt."],
        mapping_issues: [],
        tables: [
          {
            id: "t1",
            name: "Datenquellen",
            role: "dimension",
            layer: "core",
            status: "planned",
            grain: "",
            description: "Beschreibung & Fachwissen",
            load_mode: "full",
            load_strategy: "",
            columns: [
              {
                id: "c1",
                name: "Beschreibung",
                data_type: "text",
                purpose: "attribute",
                nullable: true,
                primary_key: false,
                identity: false,
                description: "Beschreibung",
                transformation: "",
                mapping: null,
              },
            ],
            relations: [],
          },
        ],
      };
      await page.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/dwh/warehouses") return route.fulfill({ json: [] });
        // Serve the real shared translation catalog.
        if (["/api/i18n/en.js", "/api/i18n/preference.js"].includes(path))
          return route.continue();
        assert.equal(
          route.request().method(),
          "GET",
          "No live business data may be written",
        );
        const result =
          path === "/api/branding"
            ? { logo_url: null }
            : path === "/api/auth/me"
              ? {
                  user: {
                    id: 1,
                    username: "fixture",
                    display_name: "Benutzername",
                    role: "admin",
                    provider: "local",
                  },
                  csrf: "fixture",
                }
              : path === "/api/sources"
                ? [source]
                : path.endsWith("/snapshot")
                  ? {
                      id: 1,
                      created: source.scanned_at,
                      payload: { tables: [table], warnings: [] },
                      notes: { [table.key]: "Dokumentation speichern" },
                    }
                  : path === "/api/dwh/projects"
                    ? [project]
                    : path === "/api/dwh/projects/1"
                      ? project
                      : path === "/api/users"
                        ? [
                            {
                              id: 1,
                              username: "Benutzername",
                              display_name: "Beschreibung",
                              role: "admin",
                              provider: "local",
                              active: true,
                            },
                          ]
                        : path === "/api/audit"
                          ? [
                              {
                                id: 1,
                                created: source.scanned_at,
                                username: "Benutzername",
                                action: "dwh_project_save",
                                source_id: 1,
                              },
                            ]
                          : path.endsWith("/schedule")
                            ? {
                                enabled: false,
                                cadence: "weekly",
                                hour: 2,
                                minute: 0,
                                weekday: 1,
                                timezone: "Europe/Berlin",
                                message: "Zeitplan aktiv.",
                              }
                            : path.endsWith("/history")
                              ? [
                                  {
                                    id: 1,
                                    created: source.scanned_at,
                                    table_count: 1,
                                    column_count: 1,
                                    relation_count: 0,
                                  },
                                ]
                              : path.startsWith("/api/search")
                                ? {
                                    total: 0,
                                    results: [],
                                    page: 1,
                                    page_size: 25,
                                  }
                                : {};
        return route.fulfill({ json: result });
      });
      await page.reload();
      await page.locator("#source-results").waitFor();
      assert.equal(
        await page.locator("h1").textContent(),
        german ? "Datenquellen" : "Data sources",
      );
      assert.equal(
        await page.locator(".source-title").textContent(),
        "Datenquellen",
      );
      assert.equal(
        await page.locator(".catalog-owner").textContent(),
        "Verantwortlich",
      );
      assert.equal(await page.locator(".tag").textContent(), "Bearbeiten");
      await page.locator('[data-action="add-source"]').click();
      assert.equal(
        await page.locator('[for="f-name"]').textContent(),
        german ? "Bezeichnung" : "Name",
      );
      assert.equal(
        await page.locator("#f-name").getAttribute("placeholder"),
        german ? "z. B. Produktions-DWH" : "e.g. Production DWH",
      );
      assert.equal(
        await page.locator("#f-port").getAttribute("placeholder"),
        "1433",
      );
      await page.locator('[data-action="close-modal"]').first().click();
      await page.locator(".source-title").click();
      await page.locator("#source-body").waitFor();
      assert.equal(await page.locator("h1").textContent(), "Datenquellen");
      assert(
        (await page.locator(".status-message").textContent()).includes(
          german ? "1 Objekte dokumentiert." : "1 objects documented.",
        ),
      );
      await page
        .locator('[data-action="source-tab"][data-tab="schema"]')
        .first()
        .click();
      assert(
        (await page.locator("#object-detail").textContent()).includes(
          "Beschreibung & Fachwissen",
        ),
      );
      assert(
        (await page.locator("#object-detail").textContent()).includes(
          "Beschreibung",
        ),
      );
      await page
        .locator('[data-action="source-tab"][data-tab="organization"]')
        .click();
      assert.equal(
        await page.locator('label[for="source-owner"]').textContent(),
        german
          ? "Verantwortliche Person oder Team"
          : "Responsible person or team",
      );
      assert.equal(
        await page.locator("#source-owner").inputValue(),
        "Verantwortlich",
      );
      await page
        .locator('[data-action="source-tab"][data-tab="schedule"]')
        .click();
      assert.equal(
        await page.locator('#schedule-weekday option[value="1"]').textContent(),
        german ? "Dienstag" : "Tuesday",
      );
      await page.locator('[data-action="nav"][data-view="warehouse"]').click();
      await page.locator(".wh-standalone > summary").click();
      await page.locator('[data-action="dwh-open"]').click();
      assert(
        (await page.locator(".dwh-prose").textContent()).includes(
          "Konzeption & Umsetzung <script>literal</script>",
        ),
      );
      assert(
        (await page.locator(".dwh-issues").textContent()).includes(
          german
            ? "Datenquellen: Granularität fehlt."
            : "Datenquellen: grain missing.",
        ),
      );
      assert.equal(await page.locator(".content script").count(), 0);
      await page.locator('[data-action="dwh-tab"][data-tab="model"]').click();
      assert.equal(
        await page.locator(".object-detail h2").textContent(),
        "Datenquellen",
      );
      await page.locator('[data-action="dwh-edit-column"]').click();
      assert.equal(await page.locator("#f-name").inputValue(), "Beschreibung");
      assert.equal(
        await page
          .locator('#dwh-purpose option[value="measure"]')
          .textContent(),
        german ? "Kennzahl" : "Measure",
      );
      await page.locator('[data-action="close-modal"]').first().click();
      await page.locator('[data-action="nav"][data-view="search"]').click();
      assert.equal(
        await page.locator("h1").textContent(),
        german ? "Globale Suche" : "Global search",
      );
      await page.locator('[data-action="nav"][data-view="users"]').click();
      await page
        .getByRole("heading", {
          name: german ? "Benutzer & Rechte" : "Users & permissions",
          exact: true,
        })
        .waitFor();
      assert(
        (await page.locator("h1").textContent()).includes(
          german ? "Benutzer" : "User",
        ),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Language UI passed: ${locale}`);
    }
    // Regional language preference, fallback, and protected interpolation.
    const page = await browser.newPage({ locale: "en-US" });
    await page.goto(baseURL);
    await page.locator("#login-form").waitFor();
    const result = await page.evaluate(() => ({
      plain: localize`<p>${"Datenquellen <script>literal</script>"}</p>`,
      attribute: localize`<button aria-label="${"Datenquellen"} öffnen">Öffnen</button>`,
      text: localize`Seite ${2} von ${10}`,
      date: new Date("2026-10-06T10:00:00Z").toLocaleDateString(uiLocale),
    }));
    assert.equal(result.plain, "<p>Datenquellen <script>literal</script></p>");
    assert.equal(
      result.attribute,
      '<button aria-label="Open Datenquellen">Open</button>',
    );
    assert.equal(result.text, "Page 2 of 10");
    console.log("Protected interpolation and pagination passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
