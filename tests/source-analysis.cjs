// Real CRUD and profiling against the fictional, disposable analysis fixture only.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  path = require("node:path");
const base = process.env.ANALYSIS_TEST_URL,
  password = process.env.ANALYSIS_TEST_PASSWORD;
if (!base || !password)
  throw new Error(
    "Set ANALYSIS_TEST_URL and ANALYSIS_TEST_PASSWORD for the disposable seeded fixture.",
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
        errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      async function signIn(name, pw) {
        await page.goto(base);
        await page.locator("#login-form").waitFor();
        await page.locator('[name="username"]').fill(name);
        await page.locator('[name="password"]').fill(pw);
        await page.locator('#login-form [type="submit"]').click();
        await page.locator("#source-results").waitFor();
      }
      await signIn("admin", password);
      await page.goto(base + "/#source/1?tab=analysis");
      await page.locator("#an-object-list tbody tr").first().waitFor();
      assert.equal(await page.locator("#an-object-list tbody tr").count(), 25);
      await page
        .locator('[data-action="an-objects-page"][data-id="2"]')
        .click();
      assert.equal(await page.locator("#an-object-list tbody tr").count(), 8);
      await page.locator("#an-object-query").fill("customers");
      assert.equal(await page.locator("#an-object-list tbody tr").count(), 1);
      await page.locator('[data-action="an-select"]').click();
      assert.equal(
        await page.locator("#an-detail h2").textContent(),
        "customers",
      );
      await page.locator('[data-action="an-tab"][data-tab="dwh"]').click();
      await page.locator("#an-preparation-form").waitFor();
      await page
        .locator('#an-preparation-form [name="role"]')
        .selectOption("dimension");
      await page
        .locator('#an-preparation-form [name="grain"]')
        .fill("One row per customer");
      await page
        .locator('#an-preparation-form [name="load_mode"]')
        .selectOption("full");
      await page
        .locator('#an-preparation-form [name="delete_strategy"]')
        .fill("Compare the complete source key set");
      const prepResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/analysis/preparation") &&
          r.request().method() === "PUT",
      );
      await page.locator('#an-preparation-form [type="submit"]').click();
      assert.equal((await prepResponse).status(), 200);
      await page.waitForFunction(() =>
        Object.values(analysisTable().readiness).every(Boolean),
      );
      await page
        .locator('[data-action="an-tab"][data-tab="dependencies"]')
        .click();
      assert(
        (await page.locator("#an-detail").textContent()).includes("orders"),
      );
      await page.locator('[data-action="an-tab"][data-tab="profiles"]').click();
      await page.locator("#an-profile-form").waitFor();
      await page.locator('[data-action="an-rule-new"]').click();
      await page.locator("#an-rule-form").waitFor();
      await page
        .locator('#an-rule-form [name="name"]')
        .fill("Customer number required " + locale);
      await page
        .locator('#an-rule-form [name="column"]')
        .selectOption("customer_number");
      await page
        .locator('#an-rule-form [name="kind"]')
        .selectOption("not_empty");
      const ruleResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/analysis/rules") && r.request().method() === "PUT",
      );
      await page.locator('#an-rule-form [type="submit"]').click();
      assert.equal((await ruleResponse).status(), 200);
      await page.waitForFunction(() => !document.getElementById("modal").open);
      const profileResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/analysis/profiles") &&
          r.request().method() === "POST",
      );
      await page.locator('#an-profile-form [type="submit"]').click();
      const prof = await profileResponse;
      assert.equal(prof.status(), 200);
      const result = await prof.json();
      await page.waitForFunction((id) => state.saProfileId === id, result.id);
      await page.locator(".an-profile-result").waitFor();
      assert(result.profile.complete_read);
      assert.equal(result.profile.row_count, 4);
      assert(result.profile.rules.some((r) => r.status === "failed"));
      assert(
        (await page.locator(".an-profile-result").textContent()).includes(
          de ? "Vollständiger Abfragebestand" : "Complete query result",
        ),
      );
      assert(
        !(await page.locator(".an-profile-result").textContent()).includes(
          "fictional-001",
        ),
      );
      if (!de) {
        assert(
          (await page.locator(".an-profile-result").textContent()).includes(
            "A passing sample does not prove full data quality",
          ),
        );
        await page.waitForFunction(
          () => !document.getElementById("toast").classList.contains("visible"),
        );
        await page.evaluate(() => scrollTo(0, 0));
        await page
          .locator("#toast")
          .evaluate((el) => (el.style.visibility = "hidden"));
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/source-analysis.png"),
          fullPage: true,
        });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      if (!de) {
        await page
          .locator("#an-detail")
          .evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page
          .locator("#toast")
          .evaluate((el) => (el.style.visibility = "hidden"));
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/source-analysis-mobile.png"),
        });
      }
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.locator('[data-action="nav"][data-view="analysis"]').click();
      await page.locator("#an-global-sources tbody tr").first().waitFor();
      assert.equal(
        await page.locator("#an-global-sources tbody tr").count(),
        10,
      );
      assert(
        (await page.locator("#an-suggestions").textContent()).includes(
          "customer",
        ),
      );
      await page.locator('[data-action="an-concept-new"]').click();
      await page.locator("#an-concept-form").waitFor();
      await page
        .locator('#an-concept-form [name="name"]')
        .fill("Customer identity " + locale);
      await page
        .locator('#an-concept-form [name="definition"]')
        .fill("Confirmed meaning <script>window.fixtureXss=1</script>");
      for (const source of ["1", "2"]) {
        await page.locator("#an-binding_source").selectOption(source);
        await page.locator("#an-binding_table").waitFor();
        await page
          .locator("#an-binding_table")
          .selectOption('["","customers"]');
        await page.locator("#an-binding_column").waitFor();
        await page
          .locator("#an-binding_column")
          .selectOption("customer_number");
        await page.locator('[data-action="an-binding-add"]').click();
        await page.locator("#an-concept-form").waitFor();
      }
      assert.equal(
        await page.locator('#an-concept-form [name="name"]').inputValue(),
        "Customer identity " + locale,
      );
      await page.locator("#an-leading").selectOption("0");
      await page
        .locator('#an-concept-form [name="transformation-1"]')
        .fill("Translate CRM IDs to ERP customer numbers");
      const conceptResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/analysis/concepts") &&
          r.request().method() === "POST",
      );
      await page.locator('#an-concept-form [type="submit"]').click();
      const response = await conceptResponse;
      assert.equal(response.status(), 200);
      const concept = await response.json();
      await page.waitForFunction(() => !document.getElementById("modal").open);
      await page.waitForFunction(
        (id) => state.analysisCatalog.concepts.some((c) => c.id === id),
        concept.id,
      );
      assert.equal(concept.bindings.length, 2);
      assert.equal(concept.leading_binding, 0);
      assert.equal(await page.evaluate(() => window.fixtureXss), undefined);
      await page
        .locator("#an-global-query")
        .fill("Customer identity " + locale);
      assert.equal(await page.locator("#an-concepts article").count(), 1);
      if (!de) {
        await page.waitForFunction(
          () => !document.getElementById("toast").classList.contains("visible"),
        );
        await page.locator("#an-global-query").fill("");
        await page.evaluate(() => scrollTo(0, 0));
        await page
          .locator("#toast")
          .evaluate((el) => (el.style.visibility = "hidden"));
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/business-concepts.png"),
          fullPage: true,
        });
        await page
          .locator("#an-global-query")
          .fill("Customer identity " + locale);
      }
      await page
        .locator(`[data-action="an-concept-edit"][data-id="${concept.id}"]`)
        .click();
      await page.locator("#an-concept-form").waitFor();
      await page
        .locator('[data-action="an-binding-remove"][data-id="1"]')
        .click();
      assert.equal(await page.locator(".an-binding-list article").count(), 1);
      await page.locator('[data-action="close-modal"]').first().click();
      const stillThere = await context.request.get(
        base + "/api/analysis/catalog",
      );
      assert.equal(
        (await stillThere.json()).concepts.find((c) => c.id === concept.id)
          .bindings.length,
        2,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.reload();
      await page.locator("#an-concepts").waitFor();
      assert(
        (await page.locator("#an-concepts").textContent()).includes(
          "Customer identity " + locale,
        ),
      );
      await context.close();
      const viewerContext = await browser.newContext({ locale }),
        viewer = await viewerContext.newPage();
      await viewer.goto(base);
      await viewer.locator("#login-form").waitFor();
      await viewer.locator('[name="username"]').fill("analysis-reader-ui");
      await viewer
        .locator('[name="password"]')
        .fill("analysis-reader-ui-password");
      await viewer.locator('#login-form [type="submit"]').click();
      await viewer.locator("#source-results").waitFor();
      await viewer.goto(base + "/#source/1?tab=analysis");
      await viewer.locator("#an-detail").waitFor();
      await viewer
        .locator('[data-action="an-tab"][data-tab="profiles"]')
        .click();
      assert.equal(await viewer.locator("#an-profile-form").count(), 0);
      assert.equal(
        await viewer.locator('[data-action="an-rule-new"]').count(),
        0,
      );
      assert.equal(await viewer.locator(".an-profile-result").count(), 0);
      await viewer.locator('[data-action="an-tab"][data-tab="dwh"]').click();
      assert.equal(
        await viewer
          .locator("#an-preparation-form fieldset")
          .getAttribute("disabled"),
        "",
      );
      assert(
        await viewer.locator('#an-preparation-form [name="role"]').isDisabled(),
      );
      await viewer.locator('[data-view="analysis"]').click();
      await viewer.locator("#an-concepts").waitFor();
      assert(
        !(await viewer.locator("#an-concepts").textContent()).includes(
          "Customer identity",
        ),
      );
      assert.equal(
        await viewer.locator('[data-action="an-concept-new"]').count(),
        0,
      );
      await viewerContext.close();
      assert.deepEqual(errors, []);
      console.log(
        "Source analysis, preparation, profiles, rules, dependencies, confirmed mappings, pagination, escaping, reader permissions and mobile passed: " +
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
