// Real design and sharing actions: run only on a disposable application instance.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const baseURL = process.env.TOOLS_TEST_URL,
  password = process.env.TOOLS_TEST_PASSWORD;
if (!baseURL || !password)
  throw Error(
    "Set TOOLS_TEST_URL and TOOLS_TEST_PASSWORD for a disposable instance.",
  );
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    for (const locale of ["de-DE", "en-US"]) {
      const context = await browser.newContext({
          locale,
          viewport: { width: 1440, height: 1050 },
        }),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("dialog", (d) => d.accept());
      await page.goto(baseURL);
      await page.locator('[name="username"]').fill("admin");
      await page.locator('[name="password"]').fill(password);
      await page.locator('#login-form [type="submit"]').click();
      await page.locator("#source-results").waitFor();
      const user = await page.evaluate(async () =>
        api("/api/users", "POST", {
          username: "tools_reader_" + Date.now(),
          display_name: "Tools fixture reader",
          password: "tools-reader-password",
          role: "viewer",
        }),
      );
      await page.locator('[data-action="nav"][data-view="tools"]').click();
      await page.locator('[data-action="tool-new"]').click();
      await page
        .locator('#tool-design-form [name="name"]')
        .fill("Order application <script>");
      await page
        .locator('#tool-design-form [name="database_name"]')
        .fill("order_app");
      await page.locator('#tool-design-form [type="submit"]').click();
      await page.locator('[data-action="tool-add-table"]').waitFor();
      const designId = await page.evaluate(() => state.toolDesign.id);
      assert.equal(await page.evaluate(() => state.toolDesign.shared), false);
      assert.equal(await page.locator(".content script").count(), 0);
      async function addTable(name) {
        await page.locator('[data-action="tool-add-table"]').click();
        await page.locator('#tool-table-form [name="name"]').fill(name);
        await page.locator('#tool-table-form [type="submit"]').click();
        await page.locator("#tool-table-form").waitFor({ state: "hidden" });
        assert.equal(await page.evaluate(() => toolTable().name), name);
      }
      async function addColumn(
        name,
        { pk = false, identity = false, type = "bigint" } = {},
      ) {
        await page.locator('[data-action="tool-add-column"]').click();
        await page.locator('#tool-column-form [name="name"]').fill(name);
        await page
          .locator('#tool-column-form [name="data_type"]')
          .selectOption(type);
        if (pk)
          await page.locator('#tool-column-form [name="primary_key"]').check();
        if (identity)
          await page.locator('#tool-column-form [name="identity"]').check();
        await page.locator('#tool-column-form [type="submit"]').click();
        await page.locator("#tool-column-form").waitFor({ state: "hidden" });
      }
      await addTable("customers");
      await addColumn("id", { pk: true, identity: true });
      await addColumn("name", { type: "varchar" });
      await addTable("orders");
      await addColumn("customer_id");
      await page.locator('[data-action="tool-add-relation"]').click();
      await page
        .locator('#tool-relation-form [name="columns"]')
        .fill("customer_id");
      await page.locator('#tool-relation-form [type="submit"]').click();
      await page.locator("#tool-relation-form").waitFor({ state: "hidden" });
      assert.equal(await page.locator("svg [data-edge-source]").count(), 1);
      const before = await page
        .locator(".dwh-diagram > svg:not(.diagram-minimap)")
        .getAttribute("viewBox");
      await page.locator('[data-diagram-command="in"]').click();
      assert.notEqual(
        await page
          .locator(".dwh-diagram > svg:not(.diagram-minimap)")
          .getAttribute("viewBox"),
        before,
      );
      await page.locator("[data-diagram-search]").fill("customers");
      await page.locator("[data-diagram-results] button").first().click();
      await page
        .locator('[data-action="tool-table"]')
        .filter({ hasText: "customers" })
        .last()
        .click();
      await page.locator('[data-action="tool-edit-column"]').first().click();
      await page
        .locator('#tool-column-form [name="name"]')
        .fill("customer_key");
      await page.locator('#tool-column-form [type="submit"]').click();
      await page.locator("#tool-column-form").waitFor({ state: "hidden" });
      assert.deepEqual(
        await page.evaluate(
          () =>
            state.toolDesign.tables.find((t) => t.name === "orders")
              .relations[0].target_columns,
        ),
        ["customer_key"],
      );
      await page.reload();
      await page.locator(".dwh-diagram").waitFor();
      assert.equal(await page.locator("svg [data-edge-source]").count(), 1);
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.locator('[data-diagram-command="fit"]').click();
      await page.evaluate(() => window.scrollTo(0, 0));
      if (locale === "en-US")
        await page.screenshot({
          path: "docs/database-designer.png",
          fullPage: true,
        });
      await page.locator('[data-action="tool-tab"][data-tab="sql"]').click();
      await page.locator('[data-action="tool-sql-preview"]').click();
      await page.waitForFunction(() => state.toolSql?.includes("FOREIGN KEY"));
      assert.match(
        await page.locator(".tool-sql-preview").textContent(),
        /CREATE TABLE/,
      );
      assert.equal(
        await page
          .locator(".tool-sql-preview")
          .textContent()
          .then((s) => s.includes("DROP DATABASE")),
        false,
      );
      for (const kind of ["mssql", "mariadb", "postgresql"]) {
        await page.locator('[data-action="tool-settings"]').click();
        await page
          .locator('#tool-design-form [name="target_kind"]')
          .selectOption(kind);
        await page.locator('#tool-design-form [type="submit"]').click();
        await page.locator("#tool-design-form").waitFor({ state: "hidden" });
        await page.locator('[data-action="tool-sql-preview"]').click();
        await page.waitForFunction(() =>
          state.toolSql?.includes("CREATE TABLE"),
        );
        assert.match(
          await page.locator(".tool-sql-preview").textContent(),
          kind === "mssql"
            ? /IDENTITY/
            : kind === "mariadb"
              ? /AUTO_INCREMENT/
              : /GENERATED BY DEFAULT AS IDENTITY/,
        );
      }
      await page.locator("#tool-sql-mode").selectOption("database");
      await page.locator('[data-action="tool-sql-preview"]').click();
      await page.waitForFunction(() =>
        state.toolSql?.includes("CREATE DATABASE"),
      );
      assert.equal(
        await page.evaluate(() => state.toolSql.includes("CREATE TABLE")),
        false,
      );
      const downloaded = page.waitForEvent("download");
      await page.locator('[data-action="tool-sql-download"]').click();
      assert.match(
        (await downloaded).suggestedFilename(),
        /order_app-database\.sql$/,
      );
      await page.locator("#tool-sql-mode").selectOption("drop");
      assert.equal(await page.locator("#tool-drop-warning").isVisible(), true);
      await page.locator('[data-action="tool-sql-preview"]').click();
      await page.waitForFunction(() =>
        state.toolSql?.includes("DROP DATABASE"),
      );
      assert.equal(
        await page.evaluate(() => state.toolDesign.tables.length),
        2,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page
        .locator('[data-action="tool-tab"][data-tab="sharing"]')
        .click();
      await page.locator('#tool-user-search [name="q"]').fill(user.username);
      await page.locator('#tool-user-search [type="submit"]').click();
      await page.locator('[data-action="tool-share-add"]').click();
      assert.equal(await page.evaluate(() => state.toolDesign.shared), false);
      await page.locator('#tool-sharing-form [type="submit"]').click();
      await page.waitForFunction(() => state.toolDesign.shared);
      if (locale === "en-US")
        await page.screenshot({
          path: "docs/database-design-sharing.png",
          fullPage: true,
        });
      const readerContext = await browser.newContext({ locale }),
        reader = await readerContext.newPage();
      await reader.goto(baseURL);
      await reader.locator('[name="username"]').fill(user.username);
      await reader.locator('[name="password"]').fill("tools-reader-password");
      await reader.locator('#login-form [type="submit"]').click();
      await reader.locator("#source-results").waitFor();
      await reader.locator('[data-action="nav"][data-view="tools"]').click();
      await reader.locator('[data-action="tool-open"]').click();
      await reader.locator(".dwh-diagram").waitFor();
      assert.equal(
        await reader
          .locator(
            '[data-action="tool-add-table"],[data-action="tool-tab"][data-tab="sharing"],[data-action="tool-settings"]',
          )
          .count(),
        0,
      );
      assert.equal(
        (
          await readerContext.request.get(
            baseURL + `/api/tools/designs/${designId}/export`,
          )
        ).status(),
        200,
      );
      await page.locator("[data-tool-grant]").selectOption("edit");
      await page.locator('#tool-sharing-form [type="submit"]').click();
      await page.waitForFunction(() => state.toolDesign.grants[0].edit);
      await reader.reload();
      await reader.locator('[data-action="tool-add-table"]').waitFor();
      assert.equal(
        await reader
          .locator('[data-action="tool-tab"][data-tab="sharing"]')
          .count(),
        0,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.locator('[data-action="tool-private"]').click();
      await page.waitForFunction(() => !state.toolDesign.shared);
      assert.equal(
        (
          await readerContext.request.get(
            baseURL + `/api/tools/designs/${designId}`,
          )
        ).status(),
        404,
      );
      assert.equal(
        (
          await readerContext.request.get(
            baseURL + `/api/tools/designs/${designId}/export`,
          )
        ).status(),
        404,
      );
      await readerContext.close();
      await page.locator('[data-action="tool-tab"][data-tab="model"]').click();
      await page
        .locator('[data-action="tool-table"]')
        .filter({ hasText: "customers" })
        .last()
        .click();
      await page.locator('[data-action="tool-edit-column"]').first().click();
      await page.locator('[data-action="tool-remove-column"]').click();
      await page.locator("#tool-column-form").waitFor({ state: "hidden" });
      assert.equal(await page.locator("svg [data-edge-source]").count(), 0);
      assert.equal(await page.evaluate(() => toolTable().columns.length), 1);
      await page.locator('[data-action="tool-remove-table"]').click();
      await page.waitForFunction(() => state.toolDesign.tables.length === 1);
      await page.locator('[data-action="tool-tab"][data-tab="sql"]').click();
      await page.locator('[data-action="tool-delete"]').click();
      await page.locator('[data-action="tool-new"]').waitFor();
      assert.equal(
        (
          await context.request.get(baseURL + `/api/tools/designs/${designId}`)
        ).status(),
        404,
      );
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        "Database design, all SQL dialects, diagram, private/read/edit sharing, revocation, removal and mobile UI passed: " +
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
