"use strict";
// Only application-owned literals pass through these helpers. Interpolated
// source names, identifiers, notes, tags and preview values remain untouched.
const uiPreference = (navigator.languages || [navigator.language]).find(
  (language) => ["de", "en"].includes(language.toLowerCase().split("-")[0]),
);
const uiLanguage = uiPreference
  ? uiPreference.toLowerCase().split("-")[0]
  : "en";
const uiLocale = uiPreference || "en-GB";
function uiText(message, ...values) {
  const text =
    uiLanguage === "en" && Object.hasOwn(UI_TRANSLATIONS, message)
      ? UI_TRANSLATIONS[message]
      : message;
  return values.length
    ? text.replace(/\{(\d+)\}/g, (_, index) => String(values[index]))
    : text;
}
function localize(strings, ...values) {
  if (typeof strings === "string") strings = [strings];
  // Delay interpolation until after translation: user content cannot be mistaken
  // for an application label or HTML, even if it contains a catalog key.
  const source = strings.reduce(
    (text, part, index) =>
      text + part + (index < values.length ? `\uE000${index}\uE001` : ""),
    "",
  );
  function translate(part) {
    const markers = [];
    const key = part.trim().replace(/\uE000(\d+)\uE001/g, (marker) => {
      markers.push(marker);
      return `{${markers.length - 1}}`;
    });
    if (!Object.hasOwn(UI_TRANSLATIONS, key)) return part;
    const result = uiText(key).replace(
      /\{(\d+)\}/g,
      (_, index) => markers[index],
    );
    return result;
  }
  function segment(part) {
    const leading = part.match(/^\s*/)[0],
      trailing = part.match(/\s*$/)[0];
    return part.trim() ? leading + translate(part.trim()) + trailing : part;
  }
  const attributes = (part) =>
    part.replace(
      /((?:title|placeholder|aria-label)=")([^"]*)(")/g,
      (_, start, value, end) => start + segment(value) + end,
    );
  const translated = source
    .split(/(<[^>]*>)/g)
    .map((part) =>
      part.startsWith("<")
        ? attributes(part)
        : /(?:title|placeholder|aria-label)="/.test(part)
          ? attributes(part)
          : segment(part),
    )
    .join("");
  return translated.replace(/\uE000(\d+)\uE001/g, (_, index) =>
    String(values[index]),
  );
}
// Stored worker messages predate the current request. Match complete known
// messages only; call this helper exclusively for generated status/issue text.
const messagePatterns = Object.keys(UI_TRANSLATIONS)
  .filter((key) => /\{\d+\}/.test(key))
  .map((key) => ({
    key,
    pattern: new RegExp(
      "^" +
        key
          .split(/\{\d+\}/)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("([\\s\\S]*?)") +
        "$",
    ),
  }));
function uiMessage(message) {
  if (uiLanguage === "de" || typeof message !== "string") return message;
  if (Object.hasOwn(UI_TRANSLATIONS, message)) return uiText(message);
  for (const { key, pattern } of messagePatterns) {
    const match = message.match(pattern);
    if (match) return uiText(key, ...match.slice(1));
  }
  return message;
}
document.documentElement.lang = uiLanguage;
document.title = uiText("DatabaseDoc · Datenbankdokumentation");
document.querySelector(".initial").textContent = uiText(
  "DatabaseDoc wird geladen …",
);
