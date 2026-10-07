// Real classification CRUD; run only on a disposable instance with 64 fictional sources.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict");
const baseURL = process.env.CLASSIFICATION_TEST_URL,
  password = process.env.CLASSIFICATION_TEST_PASSWORD;
if (!baseURL || !password)
  throw Error(
    "Set CLASSIFICATION_TEST_URL and CLASSIFICATION_TEST_PASSWORD for a disposable instance.",
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
        }),
        page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(baseURL);
      await page.locator('[name="username"]').fill("admin");
      await page.locator('[name="password"]').fill(password);
      await page.locator('#login-form [type="submit"]').click();
      await page.locator("#source-results").waitFor();
      const all = await (
        await context.request.get(baseURL + "/api/sources")
      ).json();
      assert.equal(all.length, 64);
      await page.evaluate(async () => {
        await api("/api/catalog/tags/assign", "POST", {
          source_ids: state.sources.map((s) => s.id),
          tags: ["Berlin", "ERP"],
          mode: "remove",
        });
        await loadSources();
        renderSources();
      });
      async function define(name, color, category) {
        await page.locator('[data-action="ct-manage"]').click();
        const tags = await (
            await context.request.get(baseURL + "/api/catalog/tags")
          ).json(),
          existing = tags.find((t) => t.name === name);
        await page
          .locator(
            existing
              ? `[data-action="ct-edit"][data-key="${existing.key}"]`
              : '[data-action="ct-edit"]:not([data-key])',
          )
          .click();
        if (!existing)
          await page.locator('#ct-definition-form [name="name"]').fill(name);
        await page.locator("#ct-color").selectOption(color);
        await page.locator("#ct-category").selectOption(category);
        await page.locator(`#ct-style-preview .tag-${color}`).waitFor();
        await page.locator('#ct-definition-form [type="submit"]').click();
        await page.locator(".ct-definition-list").waitFor();
        await page.locator('[data-action="close-modal"]').first().click();
      }
      await define("Berlin", "blue", "location");
      await define("ERP", "purple", "function");
      await page
        .locator("#source-host-filter")
        .selectOption("berlin.db.example.invalid");
      await page.locator('[data-action="ct-bulk"]').click();
      await page.locator("#ct-assignment-form").waitFor();
      assert.equal(
        await page.locator('#ct-assignment-form [name="source_ids"]').count(),
        32,
      );
      await page
        .locator('#ct-assignment-form [name="source_ids"]')
        .first()
        .uncheck();
      assert(
        (await page.locator("#ct-selection-count").textContent()).includes(
          "31",
        ),
      );
      await page.locator('[data-action="ct-select-all"]').click();
      await page.locator("#ct-tags").fill("Berlin, ERP");
      await page.locator('#ct-assignment-form [type="submit"]').click();
      await page.waitForFunction(
        () =>
          !document.getElementById("modal").open &&
          state.sources.filter((s) => s.tags.includes("Berlin")).length === 32,
      );
      const tagged = await (
        await context.request.get(baseURL + "/api/sources")
      ).json();
      for (const source of tagged) {
        assert.equal(source.owner, "Data Platform Team");
        assert(source.tags.includes("Existing"));
        assert.equal(
          source.tags.includes("Berlin"),
          source.config.host === "berlin.db.example.invalid",
        );
      }
      assert.equal(await page.locator("#source-results .tag-blue").count(), 25);
      assert.equal(
        await page.locator("#source-results .tag-purple").count(),
        25,
      );
      await page
        .locator('[data-action="ct-filter"][data-tag="Berlin"]')
        .first()
        .click();
      assert.equal(
        await page.locator("#source-tag-filter").inputValue(),
        "Berlin",
      );
      await page.locator('[data-action="reset-source-filters"]').click();
      await page.locator("#source-category-filter").selectOption("function");
      assert(
        (await page.locator("#source-count").textContent()).includes("32"),
      );
      if (locale === "en-US") {
        await page.evaluate(() =>
          document.getElementById("toast").classList.remove("visible"),
        );
        await page.screenshot({
          path: "docs/catalog-classification.png",
          fullPage: true,
        });
      }
      await page
        .locator('[data-action="catalog-view"][data-view="cards"]')
        .click();
      assert.equal(await page.locator(".source-card .tag-blue").count(), 25);
      await page.locator('[data-action="open"]').first().click();
      await page
        .locator('[data-action="source-tab"][data-tab="organization"]')
        .click();
      await page.locator("#classification-preview .tag-blue").waitFor();
      await page.locator('[data-action="ct-pick"]').click();
      await page.locator('[data-action="ct-pick-tag"][data-tag="ERP"]').click();
      assert.equal(
        (await page.locator("#source-tags").inputValue())
          .split(",")
          .filter((t) => t.trim() === "ERP").length,
        1,
      );
      await page
        .locator('[data-action="nav"][data-view="sources"]')
        .first()
        .click();
      await define("Berlin", "teal", "location");
      assert.equal(await page.locator("#source-results .tag-teal").count(), 25);
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.locator('[data-action="ct-bulk"]').click();
      await page.locator("#ct-assignment-form").waitFor();
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.locator('[data-action="close-modal"]').first().click();
      await page.route("**/api/auth/me", async (route) => {
        const response = await route.fetch(),
          json = await response.json();
        json.user.role = "viewer";
        await route.fulfill({ json });
      });
      await page.route("**/api/sources", async (route) => {
        const response = await route.fetch(),
          json = await response.json();
        json.forEach((s) => (s.can_edit = false));
        await route.fulfill({ json });
      });
      await page.reload();
      await page.locator("#source-results").waitFor();
      assert.equal(
        await page
          .locator('[data-action="ct-manage"],[data-action="ct-bulk"]')
          .count(),
        0,
      );
      assert.equal(await page.locator("#source-results .tag-teal").count(), 25);
      assert.deepEqual(errors, []);
      await context.close();
      console.log("Colored classification UI passed: " + locale);
    }
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
