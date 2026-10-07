"use strict";
const classificationCategories = {
  location: uiText("Standort"),
  function: uiText("Funktion"),
  environment: uiText("Umgebung"),
  other: uiText("Sonstiges"),
};
const classificationColors = {
  blue: uiText("Blau"),
  green: uiText("Grün"),
  orange: uiText("Orange"),
  red: uiText("Rot"),
  purple: uiText("Violett"),
  teal: uiText("Türkis"),
  gray: uiText("Grau"),
};
function sortedTags(tags = [], nameOf = (tag) => tag) {
  return [...tags].sort((a, b) => sourceCollator.compare(nameOf(a), nameOf(b)));
}
function tagStyle(name, source = {}) {
  return (
    source.tag_styles?.[name] ||
    (state.catalogTags || []).find(
      (tag) => tag.name.toLowerCase() === name.toLowerCase(),
    ) || { color: "gray", category: "other" }
  );
}
function tagBadge(name, source = {}, clickable = false) {
  const style = tagStyle(name, source),
    color = Object.hasOwn(classificationColors, style.color)
      ? style.color
      : "gray";
  const title =
    (classificationCategories[style.category] ||
      classificationCategories.other) +
    ": " +
    name;
  return `<${clickable ? 'button type="button"' : "span"} class="tag classification-tag tag-${color}" title="${e(title)}" ${clickable ? `data-action="ct-filter" data-tag="${e(name)}"` : ""}>${e(name)}</${clickable ? "button" : "span"}>`;
}
function classificationActions() {
  return `<div class="actions">${state.user.role === "admin" ? `<button class="btn" data-action="ct-manage">${e(uiText("Tags verwalten"))}</button>` : ""}${state.sources.some((s) => s.can_edit) ? `<button class="btn" data-action="ct-bulk">${e(uiText("Mehrere Quellen klassifizieren"))}</button>` : ""}${state.user.role === "admin" ? `<button class="btn primary" data-action="add-source">${icon("plus")} ${e(uiText("Datenquelle hinzufügen"))}</button>` : ""}</div>`;
}
function classificationFilter() {
  return `<select id="source-category-filter" aria-label="${e(uiText("Nach Tag-Kategorie filtern"))}"><option value="all">${e(uiText("Alle Kategorien"))}</option>${Object.entries(
    classificationCategories,
  )
    .map(
      ([key, label]) =>
        `<option value="${key}" ${state.tagCategoryFilter === key ? "selected" : ""}>${e(label)}</option>`,
    )
    .join("")}</select>`;
}
function classificationPreview() {
  const input = document.getElementById("source-tags"),
    preview = document.getElementById("classification-preview");
  if (input && preview)
    preview.innerHTML = sortedTags(
      input.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    )
      .map((t) => tagBadge(t, state.source))
      .join(" ");
}
function classificationSelect(label, name, options, value) {
  return `<div class="field"><label for="ct-${name}">${e(label)}</label><select id="ct-${name}" name="${name}">${Object.entries(
    options,
  )
    .map(
      ([key, text]) =>
        `<option value="${key}" ${key === value ? "selected" : ""}>${e(text)}</option>`,
    )
    .join("")}</select></div>`;
}
async function classificationReload() {
  state.catalogTags = await api("/api/catalog/tags");
  await loadSources();
  if (state.source)
    state.source =
      state.sources.find((s) => s.id === state.source.id) || state.source;
  if (state.view === "sources") renderSources();
  else if (state.view === "source") renderSource();
}
function classificationManager() {
  openModal(
    uiText("Tags verwalten"),
    `<p class="muted">${e(uiText("Definiere gemeinsame Farben und Kategorien. Diese Definitionen sind für alle angemeldeten Benutzer sichtbar; Datenbankfreigaben bleiben unverändert."))}</p><div class="actions ct-manager-head"><button class="btn primary" data-action="ct-edit">${e(uiText("Tag definieren"))}</button></div><div class="ct-definition-list">${
      sortedTags(state.catalogTags, (tag) => tag.name)
        .map(
          (tag) =>
            `<div class="ct-definition"><div>${tagBadge(tag.name)}<span class="small muted">${e(classificationCategories[tag.category])}</span></div><button class="btn" data-action="ct-edit" data-key="${tag.key}">${e(uiText("Bearbeiten"))}</button></div>`,
        )
        .join("") ||
      `<p>${e(uiText("Noch keine gemeinsamen Tags definiert. Beispiele: Berlin als Standort, ERP als Funktion, Produktion als Umgebung."))}</p>`
    }</div>`,
  );
}
function classificationTagModal(key) {
  const tag = state.catalogTags.find((t) => t.key === key) || {
    name: "",
    color: "blue",
    category: "location",
    version: 0,
  };
  openModal(
    uiText("Farbe und Kategorie festlegen"),
    `<form id="ct-definition-form" data-key="${e(key || "")}" data-version="${tag.version}">${field(uiText("Tag-Name"), "name", tag.name, "text", `required maxlength="60" ${key ? "readonly" : ""}`)}<div class="form-grid">${classificationSelect(uiText("Kategorie"), "category", classificationCategories, tag.category)}${classificationSelect(uiText("Farbe"), "color", classificationColors, tag.color)}</div><div id="ct-style-preview" class="tag-list">${tagBadge(tag.name || uiText("Vorschau"), { tag_styles: { [tag.name || uiText("Vorschau")]: tag } })}</div><p class="small muted">${e(uiText("Die Farbe gilt für diesen Tag auf allen Datenquellen. Der Name bleibt als Text sichtbar."))}</p>${key ? `<button class="text-button danger" type="button" data-action="ct-delete" data-key="${key}">${e(uiText("Farbdefinition entfernen"))}</button>` : ""}<div id="form-error" class="error-text" role="alert"></div><div class="modal-footer"><button type="button" class="btn" data-action="ct-back">${e(uiText("Zurück"))}</button><button type="submit" class="btn primary">${e(uiText("Speichern"))}</button></div></form>`,
  );
}
function classificationEditorHints() {
  return `<div id="classification-preview" class="tag-list">${sortedTags(
    state.source.tags,
  )
    .map((t) => tagBadge(t, state.source))
    .join(
      "",
    )}</div>${state.source.can_edit ? `<button class="text-button" type="button" data-action="ct-pick">${e(uiText("Gemeinsame Tags auswählen"))}</button>` : ""}<small>${e(uiText("Farben und Kategorien verwaltet ein Administrator über die Datenquellenübersicht."))}</small>`;
}
function classificationBulk() {
  const sources = filteredSources()
    .filter((s) => s.can_edit)
    .slice(0, 200);
  const options = sortedTags([
    ...new Set([
      ...state.catalogTags.map((t) => t.name),
      ...state.sources.flatMap((s) => s.tags || []),
    ]),
  ]);
  openModal(
    uiText("Mehrere Quellen klassifizieren"),
    `<form id="ct-assignment-form"><p>${e(uiText("Die Auswahl enthält bis zu 200 bearbeitbare Quellen aus dem aktuellen Filter, auch von weiteren Seiten. Prüfe die Datenbanken vor dem Speichern."))}</p><p class="small muted">${e(uiText("Für einen ganzen Server: zuerst in der Übersicht nach diesem Server filtern, dann seine Datenbanken auswählen. Neue Datenbanken erhalten Tags nicht automatisch."))}</p>${classificationSelect(uiText("Aktion"), "mode", { add: uiText("Tags ergänzen"), remove: uiText("Tags entfernen") }, "add")}<div class="field"><label for="ct-tags">${e(uiText("Tags"))}</label><input id="ct-tags" name="tags" required placeholder="Berlin, ERP" list="ct-known-tags"><datalist id="ct-known-tags">${options.map((t) => `<option value="${e(t)}"></option>`).join("")}</datalist><small>${e(uiText("Mit Kommas trennen. Bestehende Tags und Verantwortliche bleiben beim Ergänzen erhalten."))}</small></div><div class="actions"><button class="btn" type="button" data-action="ct-select-all">${e(uiText("Alle auswählen"))}</button><button class="btn" type="button" data-action="ct-select-none">${e(uiText("Auswahl aufheben"))}</button><span id="ct-selection-count" aria-live="polite"></span></div><div class="ct-source-list">${sources.map((s) => `<label class="checkbox"><input type="checkbox" name="source_ids" value="${s.id}" checked><span><strong>${e(s.name)}</strong><span class="small muted">${e(sourceHost(s))} · ${e(s.config.database || s.config.path || "")}</span></span></label>`).join("")}</div><div id="form-error" class="error-text" role="alert"></div><div class="modal-footer"><button class="btn" type="button" data-action="close-modal">${e(uiText("Abbrechen"))}</button><button class="btn primary" type="submit" ${sources.length ? "" : "disabled"}>${e(uiText("Ausgewählte Quellen aktualisieren"))}</button></div></form>`,
  );
  classificationUpdate();
}
function classificationUpdate() {
  const form = document.getElementById("ct-definition-form");
  if (form) {
    const data = Object.fromEntries(new FormData(form)),
      name = data.name || uiText("Vorschau");
    document.getElementById("ct-style-preview").innerHTML = tagBadge(name, {
      tag_styles: { [name]: data },
    });
  }
  const bulk = document.getElementById("ct-assignment-form");
  if (bulk)
    document.getElementById("ct-selection-count").textContent = uiText(
      "{0} Quellen ausgewählt",
      bulk.querySelectorAll('[name="source_ids"]:checked').length,
    );
}
async function classificationClick(button) {
  const action = button.dataset.action;
  if (action === "ct-filter") {
    if (modal.open) modal.close();
    state.tagFilter = button.dataset.tag;
    state.sourcePage = 1;
    renderSources();
  }
  if (action === "ct-manage" || action === "ct-bulk") {
    state.catalogTags = await api("/api/catalog/tags");
    if (action === "ct-manage") classificationManager();
    else classificationBulk();
  }
  if (action === "ct-edit") classificationTagModal(button.dataset.key);
  if (action === "ct-back") classificationManager();
  if (
    action === "ct-delete" &&
    confirm(
      uiText(
        "Farbdefinition entfernen? Die Tags bleiben den Datenquellen zugeordnet.",
      ),
    )
  ) {
    const tag = state.catalogTags.find((t) => t.key === button.dataset.key);
    await api(`/api/catalog/tags/${tag.key}?version=${tag.version}`, "DELETE");
    await classificationReload();
    classificationManager();
  }
  if (action === "ct-show") {
    const source = state.sources.find(
      (s) => s.id === Number(button.dataset.id),
    );
    openModal(
      uiText("Klassifikation"),
      `<p>${e(source.name)}</p><div class="tag-list">${sortedTags(source.tags)
        .map((t) => tagBadge(t, source, true))
        .join("")}</div>`,
    );
  }
  if (action === "ct-select-all" || action === "ct-select-none") {
    document
      .querySelectorAll('#ct-assignment-form [name="source_ids"]')
      .forEach((input) => (input.checked = action === "ct-select-all"));
    classificationUpdate();
  }
  if (action === "ct-pick") {
    state.catalogTags = await api("/api/catalog/tags");
    const input = document.getElementById("source-tags"),
      hint = document.getElementById("classification-picker");
    if (!hint)
      input.insertAdjacentHTML(
        "afterend",
        `<div id="classification-picker" class="tag-list"></div>`,
      );
    document.getElementById("classification-picker").innerHTML =
      sortedTags(state.catalogTags, (tag) => tag.name)
        .map(
          (t) =>
            `<button type="button" class="text-button" data-action="ct-pick-tag" data-tag="${e(t.name)}">${tagBadge(t.name)}</button>`,
        )
        .join("") ||
      `<p class="small muted">${e(uiText("Noch keine gemeinsamen Tags definiert."))}</p>`;
    classificationPreview();
  }
  if (action === "ct-pick-tag") {
    const input = document.getElementById("source-tags"),
      tags = input.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    if (!tags.some((t) => t.toLowerCase() === button.dataset.tag.toLowerCase()))
      tags.push(button.dataset.tag);
    input.value = sortedTags(tags).join(", ");
    classificationPreview();
  }
}
async function classificationSubmit(form) {
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === "ct-definition-form") {
      await api("/api/catalog/tags", "PUT", {
        ...data,
        version: Number(form.dataset.version),
      });
      await classificationReload();
      classificationManager();
      toast(uiText("Tag-Definition gespeichert."));
    }
    if (form.id === "ct-assignment-form") {
      const ids = [...form.querySelectorAll('[name="source_ids"]:checked')].map(
        (i) => Number(i.value),
      );
      if (!ids.length)
        throw Error(uiText("Bitte mindestens eine Datenquelle auswählen."));
      await api("/api/catalog/tags/assign", "POST", {
        source_ids: ids,
        tags: data.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        mode: data.mode,
      });
      modal.close();
      await classificationReload();
      toast(uiText("Tags für {0} Datenquellen aktualisiert.", ids.length));
    }
  } catch (error) {
    form.querySelector("#form-error").textContent = error.message;
    submit.disabled = false;
  }
}
