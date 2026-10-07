// Real candidate and value endpoints on the dedicated fictional SQLite fixture.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const base = process.env.FINDER_TEST_URL,
  password = process.env.FINDER_TEST_PASSWORD;
if (!base || !password)
  throw new Error(
    "Set FINDER_TEST_URL and FINDER_TEST_PASSWORD for the disposable seeded fixture.",
  );
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    for (const locale of ["de-DE", "en-US"]) {
      const de = locale === "de-DE",
        context = await browser.newContext({
          locale,
          viewport: { width: 1440, height: 1050 },
        }),
        page = await context.newPage(),
        errors = [],
        requests = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (r.url().includes("/api/finder/")) requests.push(r);
      });
      async function login(name, pw) {
        await page.goto(base);
        await page.locator("#login-form").waitFor();
        await page.locator('[name="username"]').fill(name);
        await page.locator('[name="password"]').fill(pw);
        await page.locator('#login-form [type="submit"]').click();
        await page.locator("#source-results").waitFor();
      }
      async function suggest() {
        const response = page.waitForResponse((r) =>
          r.url().endsWith("/api/finder/candidates"),
        );
        await page.locator('#df-query-form [type="submit"]').click();
        assert.equal((await response).status(), 200);
        await page.waitForFunction(() => !state.dfBusy && state.dfData);
      }
      async function values() {
        const response = page.waitForResponse((r) =>
          r.url().endsWith("/api/finder/values"),
        );
        await page.locator('#df-values-form [type="submit"]').click();
        const r = await response;
        assert.equal(r.status(), 200);
        await page.waitForFunction(() => !state.dfBusy && state.dfResults);
        return r.json();
      }
      await login("admin", password);
      await page.locator('[data-view="search"]').click();
      await page.locator('[data-action="df-mode"][data-mode="finder"]').click();
      await page.locator("#df-query-form").waitFor();
      assert.equal(
        await page.locator("h1").textContent(),
        de ? "Daten finden" : "Find data",
      );
      assert(
        (await page.locator("#df-query").getAttribute("placeholder")).includes(
          de ? "Adressen der Kunden" : "customer addresses",
        ),
      );
      assert.equal(await page.locator("#df-source option").count(), 65);
      await page.locator("#df-source").selectOption("1");
      await page
        .locator("#df-query")
        .fill(
          de
            ? "Wo finde ich die Adressen der Kunden?"
            : "Where can I find customer addresses?",
        );
      await page.locator("#df-value").fill("Musterstraße 33");
      await suggest();
      assert.equal(
        requests.filter((r) => r.url().endsWith("/values")).length,
        0,
      );
      assert.equal(
        await page.locator("#df-candidates .df-candidate").count(),
        25,
      );
      assert(
        (await page.locator("#df-candidates").textContent()).includes(
          de ? "Adressen" : "Addresses",
        ),
      );
      await page.locator('[data-df-object="0"]').check();
      assert(
        (await page.locator(".df-selected").textContent()).includes(
          "addresses",
        ),
      );
      const next = page.waitForResponse((r) =>
        r.url().endsWith("/api/finder/candidates"),
      );
      await page.locator('[data-action="df-page"][data-index="2"]').click();
      await next;
      await page.waitForFunction(
        () => !state.dfBusy && state.dfData.page === 2,
      );
      assert.equal(
        await page.locator("#df-candidates .df-candidate").count(),
        8,
      );
      assert.equal(await page.locator(".df-selected").count(), 1);
      assert(
        (await page.locator("#df-candidates").textContent()).includes(
          "Kundenadressen",
        ),
      );
      let result = await values();
      assert.equal(result.found_columns, 1);
      assert.equal(result.incomplete, false);
      assert(
        (await page.locator("#df-results").textContent()).includes(
          de ? "Wert gefunden" : "Value found",
        ),
      );
      assert(
        !(await page.locator("#df-results").textContent()).includes(
          "Musterstraße",
        ),
      );
      assert(!page.url().includes("Muster"));
      if (!de) {
        await page
          .locator("#toast")
          .evaluate((el) => (el.style.visibility = "hidden"));
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/data-finder.png"),
          fullPage: true,
        });
      }
      await page.locator("#df-example").fill("Literal_100%[x]");
      await page.locator("#df-compare").selectOption("contains");
      result = await values();
      assert.equal(result.found_columns, 1);
      assert.equal(
        await page.locator("#df-value").inputValue(),
        "Literal_100%[x]",
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.setViewportSize({ width: 1440, height: 1050 });
      const city = await page
        .locator('[data-action="df-column-open"]')
        .allTextContents();
      const cityIndex = city.indexOf("city");
      assert(cityIndex >= 0);
      await page
        .locator('[data-action="df-column-open"]')
        .nth(cityIndex)
        .click();
      await page.locator("#object-detail").waitFor();
      assert(
        (await page.locator("#object-detail").textContent()).includes(
          "addresses",
        ),
      );
      assert(page.url().includes("column=city"));
      await page.locator('[data-view="search"]').click();
      assert.equal(await page.locator("#search-form").count(), 1);
      await page.locator('[data-action="df-mode"][data-mode="finder"]').click();
      assert.equal(
        await page.locator("#df-example").inputValue(),
        "Literal_100%[x]",
      );
      await page.locator('[data-action="logout"]').first().click();
      await page.locator("#login-form").waitFor();
      assert.equal(await page.evaluate(() => state.dfValue), "");
      assert.equal(await page.evaluate(() => state.dfResults), null);
      await login("finder-reader-ui", "finder-reader-ui-password");
      await page.goto(base + "/#search?mode=finder");
      await page.locator("#df-query-form").waitFor();
      await page.locator("#df-query").fill("customer addresses");
      await suggest();
      assert.equal(await page.locator("#df-source option").count(), 2);
      assert.equal(await page.locator("[data-df-object]:enabled").count(), 0);
      assert(
        (await page.locator("#df-candidates").textContent()).includes(
          de ? "Datenberechtigung" : "data permission",
        ),
      );
      assert(
        !(await page.locator("#df-candidates").textContent()).includes(
          "Example CRM",
        ),
      );
      assert.deepEqual(errors, []);
      await context.close();
      console.log(
        "Metadata-only suggestions, DE/EN, pagination, explicit real value queries, literal wildcards, deep links, permissions, logout and mobile passed: " +
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
