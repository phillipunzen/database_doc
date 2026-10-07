// Read-only browser checks: real UI, fictional API responses, isolated instance.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const baseURL = process.env.ER_TEST_URL;
if (!baseURL)
  throw new Error("ER_TEST_URL must point to an isolated instance.");
function tables(count) {
  return Array.from({ length: count }, (_, i) => {
    const name = `table_${String(i).padStart(4, "0")}`;
    return {
      key: JSON.stringify(["public", name]),
      name,
      schema: "public",
      kind: "table",
      comment: "Fictional documentation",
      primary_key: ["id"],
      indexes: [],
      unique_constraints: [],
      columns: [
        { name: "id", type: "BIGINT", primary_key: true, nullable: false },
        { name: "parent_id", type: "BIGINT", nullable: true },
      ],
      foreign_keys: i
        ? [
            {
              name: `fk_${i}`,
              columns: ["parent_id"],
              target_schema: "public",
              target_table: `table_${String(i - 1).padStart(4, "0")}`,
              target_columns: ["id"],
            },
          ]
        : [],
    };
  });
}
const source = {
  id: 1,
  name: "Fictional large database",
  kind: "postgresql",
  config: { database: "navigation_fixture", host: "db.example.invalid" },
  can_edit: false,
  can_data: false,
  snapshot_id: 1,
  table_count: 150,
  column_count: 300,
  relation_count: 149,
  scanned_at: "2026-10-07T10:00:00",
};
const planned = Array.from({ length: 300 }, (_, i) => ({
  id: `t${i}`,
  name: `dim_${String(i).padStart(4, "0")}`,
  role: i % 3 === 0 ? "fact" : "dimension",
  layer: "core",
  status: "planned",
  grain: "One row per object",
  description: "",
  load_mode: "full",
  load_strategy: "",
  business_keys: [],
  measures: [],
  columns: [
    {
      id: `c${i}`,
      name: "id",
      data_type: "bigint",
      nullable: false,
      primary_key: true,
      identity: true,
      purpose: "technical_key",
      description: "",
      transformation: "",
      mapping: null,
    },
  ],
  relations: i
    ? [
        {
          id: `r${i}`,
          columns: ["id"],
          target_table_id: `t${i - 1}`,
          target_columns: ["id"],
        },
      ]
    : [],
}));
const project = {
  id: 10,
  name: "Central reporting model",
  goal: "Fictional large model",
  target_kind: "postgresql",
  target_schema: "warehouse",
  source_ids: [1],
  target_source_id: 1,
  version: 1,
  can_edit: false,
  tables: planned,
  issues: [],
  mapping_issues: [],
  table_count: 300,
  implemented_count: 0,
};
async function mock(page, getTables) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/i18n/en.js") return route.continue();
    assert.equal(
      route.request().method(),
      "GET",
      "Navigation must never write business data",
    );
    let result = [];
    if (url.pathname === "/api/branding") result = { logo_url: null };
    else if (url.pathname === "/api/auth/me")
      result = {
        user: {
          id: 1,
          username: "fixture",
          display_name: "Navigation test",
          role: "viewer",
          provider: "local",
        },
        csrf: "fixture",
      };
    else if (url.pathname === "/api/sources") result = [source];
    else if (url.pathname.endsWith("/snapshot"))
      result = {
        id: 1,
        created: source.scanned_at,
        payload: { tables: getTables(), warnings: [] },
        notes: {},
      };
    else if (url.pathname === "/api/dwh/projects/10") result = project;
    else if (url.pathname === "/api/dwh/warehouses/20")
      result = {
        id: 20,
        project: { ...project, warehouse_id: 20 },
        areas: [
          {
            id: "sales",
            name: "Sales",
            table_ids: planned.slice(0, 100).map((t) => t.id),
          },
        ],
        tasks: [],
        comparison: null,
      };
    else if (url.pathname === "/api/dwh/projects") result = [project];
    return route.fulfill({ json: result });
  });
}
const box = (page) =>
  page.locator("#er-svg").evaluate((svg) => ({ ...svg.diagramNavigation.box }));
const command = (page, name) =>
  page.locator(`[data-diagram-command="${name}"]`);
async function search(page, query) {
  await page.locator("[data-diagram-search]").fill(query);
  await page.locator("[data-diagram-search]").press("Enter");
}
async function drag(page, from, to, button = "left") {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up({ button });
}
function near(a, b, tolerance = 0.2) {
  assert(Math.abs(a - b) < tolerance, `${a} != ${b}`);
}
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const locale of ["en-US", "de-DE"]) {
      let objects = tables(150);
      objects[149].comment = "<script>literal & escaped</script>";
      const context = await browser.newContext({
        locale,
        viewport: { width: 1440, height: 1100 },
        acceptDownloads: true,
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mock(page, () => objects);
      await page.goto(baseURL + "/#source/1?tab=er");
      await page.locator("#er-svg .er-node").first().waitFor();
      assert.equal(await page.locator("#er-svg .er-node").count(), 150);
      assert.equal(
        await command(page, "fit").textContent(),
        locale === "de-DE" ? "Alles einpassen" : "Fit all",
      );
      await command(page, "fit").click();
      let initial = await box(page);
      const bounds = await page
        .locator("#er-svg")
        .evaluate((svg) => svg.diagramNavigation.bounds());
      assert(initial.x <= bounds.x && initial.y <= bounds.y);
      assert(initial.x + initial.width >= bounds.x + bounds.width - 0.1);
      const stage = await page.locator("#er-svg").boundingBox();
      near(initial.width / initial.height, stage.width / stage.height, 0.001);
      const pointer = {
        x: Math.round(stage.x + stage.width * 0.31),
        y: Math.round(stage.y + stage.height * 0.4),
      };
      const fx = (pointer.x - stage.x) / stage.width,
        fy = (pointer.y - stage.y) / stage.height;
      const anchor = {
        x: initial.x + initial.width * fx,
        y: initial.y + initial.height * fy,
      };
      await page.mouse.move(pointer.x, pointer.y);
      await page.mouse.wheel(0, -200);
      await page.waitForFunction(
        (width) =>
          document.getElementById("er-svg").diagramNavigation.box.width < width,
        initial.width,
      );
      let after = await box(page);
      near(after.x + after.width * fx, anchor.x);
      near(after.y + after.height * fy, anchor.y);
      await command(page, "actual").click();
      near((await box(page)).width, stage.width);
      await page.locator("#er-svg").focus();
      initial = await box(page);
      await page.keyboard.press("ArrowRight");
      near((await box(page)).x, initial.x + 80);
      await page.keyboard.press("+");
      assert((await box(page)).width < initial.width);
      await page.keyboard.press("Home");
      near(
        (await box(page)).width,
        stage.width /
          Math.min(1, stage.width / bounds.width, stage.height / bounds.height),
      );
      await search(page, "table_0149");
      assert.equal(
        await page.locator(".diagram-selected").getAttribute("data-er-index"),
        "149",
      );
      assert.equal(await page.locator(".diagram-edge-active").count(), 1);
      assert.equal(
        await page.locator("#er-svg .diagram-dimmed.er-node").count(),
        148,
      );
      assert((await box(page)).width < stage.width * 2);
      await command(page, "neighbors").click();
      const selected = page.locator('.er-node[data-er-index="149"]');
      let n = await selected.boundingBox(),
        from = { x: n.x + 40, y: n.y + 20 };
      const key = objects[149].key;
      const position = () =>
        page.evaluate((key) => ({ ...state.erPositions[key] }), key);
      let originalPosition = await position();
      initial = await box(page);
      await page.mouse.move(from.x, from.y);
      await page.keyboard.down("Space");
      await drag(page, from, { x: from.x + 75, y: from.y + 40 });
      await page.keyboard.up("Space");
      assert((await box(page)).x < initial.x);
      assert.deepEqual(await position(), originalPosition);
      assert.equal(
        await page.evaluate(() => state.tab),
        "er",
        "Space-drag must not open details",
      );
      n = await selected.boundingBox();
      from = { x: n.x + 40, y: n.y + 20 };
      initial = await box(page);
      await drag(page, from, { x: from.x + 50, y: from.y + 25 });
      assert((await position()).x > originalPosition.x);
      near((await box(page)).x, initial.x);
      assert.equal(await page.locator("#er-edges path").count(), 149);
      const downloadEvent = page.waitForEvent("download");
      await page.locator('[data-action="er-download"]').click();
      const download = await downloadEvent,
        content = await fs.readFile(await download.path(), "utf8");
      assert.equal((content.match(/class="er-node/g) || []).length, 150);
      assert.match(content, /preserveAspectRatio="xMidYMid meet"/);
      const full = await page
        .locator("#er-svg")
        .evaluate((svg) => svg.diagramNavigation.bounds());
      assert(
        content.includes(
          `viewBox="${full.x} ${full.y} ${full.width} ${full.height}"`,
        ),
        "SVG export must include the whole model",
      );
      await command(page, "fullscreen").click();
      await page.waitForFunction(() => !!document.fullscreenElement);
      await command(page, "fullscreen").click();
      await page.waitForFunction(() => !document.fullscreenElement);
      initial = await box(page);
      await page
        .locator(".diagram-minimap")
        .click({ position: { x: 30, y: 30 } });
      assert.notEqual((await box(page)).x, initial.x);
      await search(page, "table_0149");
      if (locale === "en-US") {
        await command(page, "neighbors").click();
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/er-navigation.png"),
          fullPage: true,
        });
      }
      await page.locator(".diagram-selected").focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => state.tab === "schema");
      assert.equal(await page.evaluate(() => state.table), 149);
      assert.equal(await page.evaluate(() => diagramControllers.size), 0);
      await page.goto(baseURL + "/#warehouse-project/10?step=model");
      await page.locator(".dwh-diagram-node").first().waitFor();
      assert.equal(await page.locator(".dwh-diagram-node").count(), 300);
      await search(page, "dim_0299");
      let plannedNode = page.locator('.dwh-diagram-node[data-id="t299"]');
      n = await plannedNode.boundingBox();
      from = { x: n.x + 30, y: n.y + 20 };
      await drag(page, from, { x: from.x + 80, y: from.y + 20 });
      assert.notEqual(
        await page.evaluate(() => state.dwhTableId),
        "t299",
        "Panning must not open a planned table",
      );
      await search(page, "dim_0299");
      await plannedNode.click();
      await page.waitForFunction(() => state.dwhTableId === "t299");
      assert.equal(await page.evaluate(() => diagramControllers.size), 1);
      await search(page, "dim_0298");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => state.dwhTableId === "t298");
      await page.goto(baseURL + "/#warehouse-workspace/20?phase=model");
      await page.locator(".dwh-diagram-node").first().waitFor();
      assert.equal(await page.locator(".dwh-diagram-node").count(), 300);
      await search(page, "dim_0299");
      assert.equal(
        await page.locator(".diagram-selected").getAttribute("data-id"),
        "t299",
      );
      await page.locator("#wh-filter").selectOption("sales");
      assert.equal(await page.locator(".dwh-diagram-node").count(), 100);
      assert.equal(await page.evaluate(() => diagramControllers.size), 1);
      await search(page, "dim_0099");
      await page.keyboard.press("Enter");
      await page.waitForFunction(
        () => state.dwhTableId === "t99" && state.view === "warehouse-project",
      );
      assert.equal(
        await page.locator(".object-detail h2").textContent(),
        "dim_0099",
      );
      await page.goto(baseURL + "/#sources");
      await page.locator(".source-list").waitFor();
      assert.equal(await page.evaluate(() => diagramControllers.size), 0);
      objects = tables(2000);
      await page.goto(baseURL + "/#source/1?tab=er");
      await page.waitForFunction(
        () => document.querySelectorAll("#er-svg .er-node").length === 2000,
      );
      await search(page, "table_1999");
      assert.equal(
        await page.locator(".diagram-selected").getAttribute("data-er-index"),
        "1999",
      );
      assert.deepEqual(errors, []);
      console.log(
        `${locale}: 150/2000 scanned and 300 planned tables, zoom anchor, pan, Space-drag, node drag, search, neighbors, SVG, fullscreen, minimap, keyboard, cleanup passed`,
      );
      await context.close();
    }
    const context = await browser.newContext({
      locale: "en-US",
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mock(page, () => tables(150));
    await page.goto(baseURL + "/#source/1?tab=er");
    await page.locator("#er-svg").waitFor();
    await page.locator("#er-svg").scrollIntoViewIfNeeded();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const r = await page.locator("#er-svg").boundingBox(),
      c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const session = await context.newCDPSession(page);
    const touch = (type, points) =>
      session.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((p, id) => ({
          ...p,
          id,
          radiusX: 4,
          radiusY: 4,
        })),
      });
    const original = await box(page),
      layout = await page.evaluate(() => JSON.stringify(state.erPositions));
    await touch("touchStart", [
      { x: c.x - 30, y: c.y },
      { x: c.x + 30, y: c.y },
    ]);
    await touch("touchMove", [
      { x: c.x - 70, y: c.y + 20 },
      { x: c.x + 70, y: c.y + 20 },
    ]);
    await touch("touchEnd", []);
    await page.waitForFunction(
      (width) =>
        document.getElementById("er-svg").diagramNavigation.box.width < width,
      original.width,
    );
    assert.equal(
      await page.evaluate(() => JSON.stringify(state.erPositions)),
      layout,
    );
    let before = await box(page);
    await touch("touchStart", [c]);
    await touch("touchMove", [{ x: c.x + 35, y: c.y + 30 }]);
    await touch("touchEnd", []);
    assert((await box(page)).x < before.x);
    assert.deepEqual(errors, []);
    console.log(
      "Mobile: no horizontal overflow, native two-finger pinch and one-finger pan passed",
    );
    await context.close();
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
