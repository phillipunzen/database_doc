const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const projectRoot = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(projectRoot, ".env"), "utf8")
    .split("\n")
    .filter((s) => s && !s.startsWith("#"))
    .map((s) => {
      const p = s.indexOf("=");
      return [s.slice(0, p), s.slice(p + 1)];
    }),
);
(async () => {
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(env.APP_URL);
  await page.getByLabel("Benutzername", { exact: true }).fill("admin");
  await page.getByLabel("Passwort", { exact: true }).fill(env.ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await page
    .getByRole("heading", { name: "Datenquellen", exact: true })
    .waitFor();
  const already = await page
    .getByRole("button", { name: "Beispiel · Bestellverwaltung", exact: true })
    .count();
  if (!already) {
    await page
      .getByRole("button", { name: "Datenquelle hinzufügen", exact: true })
      .first()
      .click();
    await page
      .getByLabel("Bezeichnung", { exact: true })
      .fill("Beispiel · Bestellverwaltung");
    await page
      .getByLabel("Datenbanksystem", { exact: true })
      .selectOption("sqlite");
    await page
      .getByLabel("SQLite-Datei im Container", { exact: true })
      .fill("/sources/beispiel.sqlite");
    await page
      .getByRole("button", { name: "Verbindung testen", exact: true })
      .click();
    await page
      .locator("#toast")
      .filter({ hasText: "Verbindung erfolgreich." })
      .waitFor();
    await page.getByRole("button", { name: "Speichern", exact: true }).click();
  } else
    await page
      .getByRole("button", {
        name: "Beispiel · Bestellverwaltung",
        exact: true,
      })
      .click();
  await page
    .getByRole("heading", { name: "Beispiel · Bestellverwaltung", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Schema scannen", exact: true })
    .first()
    .click();
  await page
    .getByText("6 Objekte dokumentiert.", { exact: true })
    .waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "ER-Modell", exact: true }).click();
  await page.locator("#er-svg .er-node").first().waitFor();
  fs.mkdirSync(path.join(projectRoot, "docs"), { recursive: true });
  await page.screenshot({
    path: path.join(projectRoot, "docs/er-modell.png"),
    fullPage: true,
  });
  if ((await page.locator("#er-svg .er-edge").count()) !== 4)
    throw new Error("Expected four ER relations");
  await page
    .getByRole("button", { name: "Tabellen & Felder", exact: true })
    .click();
  await page.getByRole("button", { name: /^customers/ }).click();
  await page
    .getByRole("button", { name: "Dokumentation", exact: true })
    .click();
  await page
    .getByLabel("Beschreibung & Fachwissen", { exact: true })
    .fill("Fiktive Beispieldaten zum Ausprobieren. Keine echten Kundendaten.");
  await page
    .getByRole("button", { name: "Dokumentation speichern", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Datenvorschau", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Datenvorschau laden", exact: true })
    .click();
  await page
    .getByRole("cell", { name: "Beispiel GmbH", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Datenquellen", exact: true }).click();
  await page.screenshot({
    path: path.join(projectRoot, "docs/datenquellen.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Datenquelle hinzufügen", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Bezeichnung", { exact: true })
    .fill("Browser-Test-Verbindung");
  await page
    .getByLabel("Datenbanksystem", { exact: true })
    .selectOption("postgresql");
  if (await page.locator(".mongo-field:visible").count())
    throw new Error("Mongo fields visible for postgres");
  await page.getByRole("button", { name: "Schließen", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(projectRoot, "docs/mobil.png"),
    fullPage: true,
  });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw new Error("Mobile horizontal overflow");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "Browser passed: login, SQLite connection, scan, 4 ER relations, notes, data preview, connection form, mobile layout.",
  );
  await browser.close();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
