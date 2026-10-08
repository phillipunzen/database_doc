// Real upload/remove flows on a disposable instance, with fictional company artwork.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const baseURL = process.env.BRANDING_TEST_URL;
const password = process.env.BRANDING_TEST_PASSWORD;
if (!baseURL || !password)
  throw new Error(
    "Set BRANDING_TEST_URL and BRANDING_TEST_PASSWORD for an isolated test instance.",
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
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(baseURL);
      await page.locator("#login-form").waitFor();
      assert.equal(await page.locator(".company-logo").count(), 0);
      await page.locator('[name="username"]').fill("admin");
      await page.locator('[name="password"]').fill(password);
      await page.locator('#login-form [type="submit"]').click();
      await page.locator("#source-results").waitFor();
      await page.locator('[data-view="settings"]').click();
      await page.locator("#branding-form").waitFor();
      assert.equal(
        await page.locator("h1").textContent(),
        locale === "de-DE" ? "Systemeinstellungen" : "System settings",
      );

      assert.equal(
        await page.locator("#company-logo-title").textContent(),
        locale === "de-DE" ? "Firmenlogo" : "Company logo",
      );
      assert.equal(await page.locator('[data-view="branding"]').count(), 0);
      assert(page.url().endsWith("#settings"));
      assert(
        (await page.locator(".breadcrumb").textContent()).includes(
          "Administration",
        ),
      );
      assert(
        await page
          .locator('[data-view="settings"]')
          .evaluate((el) => el.classList.contains("active")),
      );
      // Existing links to the logo page still open the new system settings.
      await page.goto(baseURL + "/#branding");
      await page.waitForURL("**/#settings");
      await page.locator("#branding-form").waitFor();
      assert(page.url().endsWith("#settings"));

      const customName = "Datenquellen & <b>Example</b> {0}";
      const savedName = async (name) => {
        await page.locator("#application-name").fill(name);
        await page.locator('#branding-name-form [type="submit"]').click();
        await page.waitForFunction(
          (name) =>
            document.querySelector(".application-name")?.textContent === name,
          name,
        );
        assert.equal(await page.locator(".application-name b").count(), 0);
        assert.equal(
          await page.title(),
          name +
            (locale === "de-DE"
              ? " · Datenbankdokumentation"
              : " · Database documentation"),
        );
      };
      assert.equal(
        await page.locator("#application-name-title").textContent(),
        locale === "de-DE" ? "Anwendungsname" : "Application name",
      );
      assert.equal(
        await page.locator("#application-name").inputValue(),
        "DatabaseDoc",
      );
      await page.locator("#application-name").fill(customName);
      assert.equal(
        await page.locator(".application-name").textContent(),
        "DatabaseDoc",
      );
      await savedName(customName);
      await page.reload();
      await page.locator("#branding-name-form").waitFor();
      assert.equal(
        await page.locator("#application-name").inputValue(),
        customName,
      );
      // Long names stay within the sidebar and mobile header.
      await savedName("Example".repeat(11));
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 844 });
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      await savedName(customName);

      const makeLogo = async (color) =>
        Buffer.from(
          await page.evaluate((color) => {
            const canvas = document.createElement("canvas");
            canvas.width = 600;
            canvas.height = 160;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = color;
            ctx.fillRect(0, 20, 120, 120);
            ctx.fillStyle = "white";
            ctx.font = "bold 48px sans-serif";
            ctx.fillText("EX", 24, 100);
            ctx.fillStyle = color;
            ctx.font = "bold 40px sans-serif";
            ctx.fillText("Example Company", 145, 95);
            return canvas.toDataURL("image/png").split(",")[1];
          }, color),
          "base64",
        );
      const upload = async (color) => {
        await page.locator("#company-logo-file").setInputFiles({
          name: "example-company.png",
          mimeType: "image/png",
          buffer: await makeLogo(color),
        });
        await page.waitForFunction(
          () =>
            document.getElementById("branding-preview-status").textContent
              .length > 0,
        );
      };
      await upload("#286454");
      assert.equal(await page.locator(".company-logo").count(), 0);
      assert.equal(
        (await (await context.request.get(baseURL + "/api/branding")).json())
          .logo_url,
        null,
      );
      await page.locator('#branding-form [type="submit"]').click();
      await page.locator(".company-logo").waitFor();
      assert.equal(
        await page.locator(".application-name").textContent(),
        customName,
      );
      const originalURL = await page
        .locator(".company-logo")
        .getAttribute("src");
      await page.waitForFunction(
        () =>
          document.querySelector(".company-logo")?.complete &&
          document.querySelector(".company-logo").naturalWidth > 0,
      );
      await page.reload();
      await page.locator("#branding-form").waitFor();
      assert.equal(
        await page.locator(".company-logo").getAttribute("src"),
        originalURL,
      );
      if (locale === "en-US") {
        await savedName("Example Data Portal");
        await page.screenshot({
          path: path.resolve(__dirname, "../docs/company-logo.png"),
          fullPage: true,
        });
        await savedName(customName);
      }

      const publicContext = await browser.newContext({ locale });
      const signIn = await publicContext.newPage();
      await signIn.goto(baseURL);
      await signIn.locator("#login-form").waitFor();
      assert.equal(
        await signIn.locator(".company-logo").getAttribute("src"),
        originalURL,
      );
      assert.equal(
        await signIn.locator(".application-name").textContent(),
        customName,
      );
      assert.equal(
        await signIn.title(),
        customName +
          (locale === "de-DE"
            ? " · Datenbankdokumentation"
            : " · Database documentation"),
      );
      assert.equal(
        await signIn.locator(".login-box > .eyebrow").textContent(),
        (locale === "de-DE" ? "Willkommen bei " : "Welcome to ") + customName,
      );
      assert.equal(await signIn.locator(".login-box .eyebrow b").count(), 0);
      await publicContext.close();

      await page.locator("#company-logo-file").setInputFiles({
        name: "oversized.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
      });
      assert(
        (await page.locator("#form-error").textContent()).includes("2 MB"),
      );
      assert.equal(
        await page
          .locator("#company-logo-file")
          .evaluate((input) => input.files.length),
        0,
      );
      assert.equal(
        await page.locator("#branding-preview img").getAttribute("src"),
        originalURL,
      );
      await page.locator("#company-logo-file").setInputFiles({
        name: "invalid.png",
        mimeType: "image/png",
        buffer: Buffer.from("not an image"),
      });
      await page.locator('#branding-form [type="submit"]').click();
      await page.waitForFunction(() =>
        document.getElementById("form-error").textContent.includes("PNG"),
      );
      assert.equal(
        await page.locator(".company-logo").getAttribute("src"),
        originalURL,
      );
      await upload("#384d91");
      await page.locator('#branding-form [type="submit"]').click();
      await page.waitForFunction(
        (original) =>
          document.querySelector(".company-logo")?.getAttribute("src") !==
          original,
        originalURL,
      );
      const replacedURL = await page
        .locator(".company-logo")
        .getAttribute("src");

      await page.setViewportSize({ width: 1440, height: 600 });
      assert(
        await page
          .locator(".sidebar")
          .evaluate(
            (sidebar) =>
              sidebar.scrollHeight <= sidebar.clientHeight ||
              getComputedStyle(sidebar).overflowY === "auto",
          ),
      );
      await page.setViewportSize({ width: 390, height: 844 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      );
      await page.route("**/api/auth/me", async (route) => {
        const response = await route.fetch();
        const me = await response.json();
        me.user.role = "viewer";
        await route.fulfill({ json: me });
      });
      await page.reload();
      await page.locator("#source-results").waitFor();
      assert.equal(await page.locator('[data-view="settings"]').count(), 0);
      assert.equal(
        await page.locator(".company-logo").getAttribute("src"),
        replacedURL,
      );
      assert(page.url().endsWith("#sources"));
      for (const route of ["settings", "branding"]) {
        await page.goto(baseURL + "/#" + route);
        await page.waitForURL("**/#sources");
        await page.locator("#source-results").waitFor();
        assert.equal(await page.locator("#branding-form").count(), 0);
        assert(page.url().endsWith("#sources"));
      }

      await page.unroute("**/api/auth/me");
      await page.reload();
      await page.locator("#source-results").waitFor();
      await page.locator('[data-view="settings"]').click();
      await page.locator("#branding-form").waitFor();
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.locator('[data-action="branding-remove"]').click();
      assert.equal(
        await page.locator(".company-logo").getAttribute("src"),
        replacedURL,
      );
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator('[data-action="branding-remove"]').click();
      await page.waitForFunction(
        () => !document.querySelector(".company-logo"),
      );
      assert.equal(
        (await context.request.get(baseURL + "/api/branding/logo")).status(),
        404,
      );
      assert.equal(
        await page.locator(".application-name").textContent(),
        customName,
      );
      await page.locator('[data-action="branding-name-default"]').click();
      assert.equal(
        await page.locator("#application-name").inputValue(),
        "DatabaseDoc",
      );
      assert.equal(
        await page.locator(".application-name").textContent(),
        customName,
      );
      await savedName("DatabaseDoc");
      await page.locator('[data-action="logout"]').last().click();
      await page.locator("#login-form").waitFor();
      assert.equal(await page.locator(".company-logo").count(), 0);
      assert.deepEqual(errors, []);
      await context.close();
      console.log("Application name and company logo UI passed: " + locale);
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
