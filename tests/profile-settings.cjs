// Real personal settings on the fictional MariaDB application fixture.
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const base = process.env.PROFILE_TEST_URL,
  password = process.env.PROFILE_TEST_PASSWORD,
  external = process.env.PROFILE_TEST_EXTERNAL_SESSION;
if (!base || !password || !external)
  throw new Error(
    "Set PROFILE_TEST_URL, PROFILE_TEST_PASSWORD and PROFILE_TEST_EXTERNAL_SESSION for the dedicated seeded fixture.",
  );
(async () => {
  const browser = await chromium.launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      args: ["--no-sandbox"],
    }),
    errors = [];
  async function context(locale) {
    const c = await browser.newContext({
      locale,
      viewport: { width: 1440, height: 1050 },
    });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    return [c, p];
  }
  async function login(p, name, pw) {
    await p.goto(base);
    await p.locator("#login-form").waitFor();
    await p.locator('[name="username"]').fill(name);
    await p.locator('[name="password"]').fill(pw);
    await p.locator('#login-form [type="submit"]').click();
    await p.locator("#source-results").waitFor();
  }
  async function profile(p) {
    await p.locator('[data-view="profile"]:visible').first().click();
    await p.locator("#profile-form").waitFor();
  }
  async function save(p, language, name) {
    if (name !== undefined) await p.locator("#profile-name").fill(name);
    await p.locator("#profile-language").selectOption(language);
    const result = p.waitForResponse(
      (r) => r.url().endsWith("/api/profile") && r.request().method() === "PUT",
    );
    await p.locator('#profile-form [type="submit"]').click();
    const r = await result;
    assert.equal(r.status(), 200);
    await p.waitForFunction(
      (lang) =>
        state.user?.language === lang &&
        document.querySelector("#profile-language")?.value === lang &&
        !document.querySelector('#profile-form [type="submit"]').disabled,
      language,
    );
  }
  async function language(p, expected) {
    await p.waitForFunction((lang) => uiLanguage === lang, expected);
    await p.locator("#profile-form").waitFor();
    assert.equal(await p.locator("html").getAttribute("lang"), expected);
    assert(
      (await p.locator(".profile-link").textContent()).includes(
        expected === "de" ? "Profileinstellungen" : "Profile settings",
      ),
    );
    assert.equal(
      await p.locator("h1").textContent(),
      expected === "de" ? "Profileinstellungen" : "Profile settings",
    );
  }
  async function logout(p) {
    await p.locator('[data-action="logout"]:visible').first().click();
    await p.locator("#login-form").waitFor();
  }
  try {
    let [c, p] = await context("de-DE");
    await login(p, "admin", password);
    await profile(p);
    await language(p, "de");
    assert.equal(await p.locator("#profile-language").inputValue(), "auto");
    assert.equal(await p.locator("#profile-language option").count(), 3);
    const literal = "Datenquellen <script>window.profileXss=1</script>";
    await save(p, "auto", literal);
    assert.equal(await p.locator("#profile-name").inputValue(), literal);
    assert.equal(await p.evaluate(() => window.profileXss), undefined);
    assert((await p.locator(".user-line").textContent()).includes(literal));
    await save(p, "en", "Example administrator");
    await language(p, "en");
    assert.equal(await p.evaluate(() => roles.editor), "Editor");
    assert.equal(
      await p.evaluate(() => classificationCategories.location),
      "Location",
    );
    assert.equal(await p.evaluate(() => uiLocale), "en-GB");
    const exported = await c.request.get(
      base + "/api/sources/1/export?format=markdown",
      { headers: { "Accept-Language": "de" } },
    );
    assert.equal(exported.status(), 200);
    assert.equal(exported.headers()["content-language"], "en");
    assert((await exported.text()).includes("Type:"));
    assert((await exported.text()).includes("# Datenquellen"));
    const pdf = await c.request.get(base + "/api/sources/1/export?format=pdf");
    assert.equal(pdf.status(), 200);
    assert.equal(pdf.headers()["content-language"], "en");
    assert((await pdf.body()).subarray(0, 5).equals(Buffer.from("%PDF-")));
    await p.reload();
    await p.locator("#profile-form").waitFor();
    await language(p, "en");
    assert.equal(
      await p.locator("#profile-name").inputValue(),
      "Example administrator",
    );
    await p.locator('.content [data-action="password"]').click();
    await p.locator("#password-form").waitFor();
    assert(
      (await p.locator("#password-form").textContent()).includes(
        "Current password",
      ),
    );
    await p.locator('[data-action="close-modal"]').first().click();
    await p
      .locator("#toast")
      .evaluate((el) => (el.style.visibility = "hidden"));
    await p.screenshot({
      path: path.resolve(__dirname, "../docs/profile-settings.png"),
      fullPage: true,
    });
    for (const width of [390, 320]) {
      await p.setViewportSize({ width, height: 844 });
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      assert(await p.locator(".profile-mobile").isVisible());
    }
    await logout(p);
    assert.equal(await p.locator("html").getAttribute("lang"), "de");
    await c.close();
    [c, p] = await context("fr-FR");
    await login(p, "admin", password);
    await profile(p);
    await language(p, "en");
    assert.equal(await p.locator("#profile-language").inputValue(), "en");
    await logout(p);
    await c.close();
    [c, p] = await context("en-US");
    await login(p, "admin", password);
    await profile(p);
    await save(p, "de");
    await language(p, "de");
    assert.equal(await p.evaluate(() => roles.viewer), "Leser");
    assert.equal(await p.evaluate(() => classificationColors.blue), "Blau");
    await save(p, "auto");
    await language(p, "en");
    assert.equal(await p.evaluate(() => uiLocale), "en-US");
    // Two active accounts must retain independent settings on the same server.
    for (const username of ["profile-reader", "profile-editor"]) {
      const [other, reader] = await context("en-US");
      await login(reader, username, "profile-reader-password-123");
      await profile(reader);
      await save(reader, "de");
      await language(reader, "de");
      assert.equal(await reader.locator('[name="role"]').count(), 0);
      assert.equal(await reader.locator('[data-view="users"]').count(), 0);
      assert.equal(
        (await other.request.get(base + "/api/users")).status(),
        403,
      );
      assert.equal(
        (await c.request.get(base + "/api/profile")).headers()[
          "content-language"
        ],
        "en",
      );
      await reader.setViewportSize({ width: 390, height: 844 });
      assert(
        await reader.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await reader.locator('[data-view="sources"]:visible').first().click();
      await reader.locator("#source-results").waitFor();
      assert(
        await reader.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await profile(reader);
      await language(reader, "de");
      await logout(reader);
      assert.equal(await reader.locator("html").getAttribute("lang"), "en");
      await other.close();
    }
    await c.close();
    [c, p] = await context("en-US");
    const { token } = JSON.parse(fs.readFileSync(external, "utf8"));
    const url = new URL(base);
    await c.addCookies([
      {
        name: "datatlas_session",
        value: token,
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await p.goto(base + "/#profile");
    await p.locator("#profile-form").waitFor();
    assert(await p.locator("#profile-name").isDisabled());
    assert.equal(await p.locator('[data-action="password"]').count(), 0);
    await save(p, "de");
    await language(p, "de");
    assert.equal(
      await p.locator("#profile-name").inputValue(),
      "profile-entra",
    );
    assert(await p.locator("#profile-name").isDisabled());
    // Revoke the session outside the page, then exercise its expired-auth flow.
    const csrf = await p.evaluate(() => state.csrf);
    assert.equal(
      (
        await c.request.post(base + "/api/auth/logout", {
          data: {},
          headers: { "X-CSRF-Token": csrf },
        })
      ).status(),
      200,
    );
    await p.locator('[data-view="profile"]:visible').first().click();
    await p.locator("#login-form").waitFor();
    assert.equal(await p.locator("html").getAttribute("lang"), "en");
    await c.close();
    assert.deepEqual(errors, []);
    console.log(
      "MariaDB upgrade, real profile persistence, name escaping, full language reload, regional fallback, new browser/login, exports, independent roles, external account controls, logout and mobile passed.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
