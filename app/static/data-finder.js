// Local metadata suggestions followed by an explicit search in selected text fields.
function finderReset() {
  state.dfRunId = (state.dfRunId || 0) + 1;
  state.dfQuery = "";
  state.dfValue = "";
  state.dfSource = "all";
  state.dfMode = "exact";
  state.dfData = null;
  state.dfResults = null;
  state.dfSelection = {};
  state.dfBusy = false;
  state.dfError = "";
  state.dfRequest = null;
}
function searchModes() {
  return localize`<div class="tabs df-modes"><button class="tab ${state.searchMode !== "finder" ? "active" : ""}" type="button" data-action="df-mode" data-mode="metadata">Metadatensuche</button><button class="tab ${state.searchMode === "finder" ? "active" : ""}" type="button" data-action="df-mode" data-mode="finder">Daten finden</button></div>`;
}
function dfButton(label, action, index = "", extra = "") {
  return `<button class="btn" type="button" data-action="df-${action}" data-index="${e(index)}" ${extra}>${e(uiText(label))}</button>`;
}
function dfKey(c) {
  return JSON.stringify([c.source_id, c.table_key]);
}
function finderRemember() {
  const form = document.getElementById("df-query-form");
  if (!form) return;
  const f = new FormData(form);
  state.dfQuery = f.get("query") || state.dfQuery || "";
  state.dfValue = f.get("value") ?? state.dfValue ?? "";
  state.dfSource = f.get("source") || state.dfSource || "all";
  state.dfMode =
    document.getElementById("df-compare")?.value || state.dfMode || "exact";
}
function renderFinder() {
  const previousList = document.querySelector(".df-candidate-list"),
    focus = document.activeElement?.id;
  const previousScroll =
    previousList?.dataset.page === String(state.dfData?.page)
      ? previousList.scrollTop
      : 0;
  if (state.dfSelection === undefined) finderReset();
  const d = state.dfData,
    selected = Object.values(state.dfSelection),
    count = selected.reduce((n, t) => n + t.columns.length, 0);
  shell(
    localize`<div class="page-head"><div><div class="eyebrow">Datenbankübergreifend</div><h1>Daten finden</h1><p>Beschreibe gesuchte Daten, prüfe passende Tabellen und suche anschließend gezielt nach einem Beispielwert.</p></div></div>${searchModes()}<section class="panel panel-body"><h2>1. Passende Tabellen finden</h2><p class="small muted">Die lokale Begriffssuche nutzt deutsche und englische Synonyme, Namen, Kommentare, Notizen, Beziehungen und bestätigte Fachbegriffe. Vorschläge sind Hinweise und müssen fachlich geprüft werden.</p><form id="df-query-form"><fieldset ${state.dfBusy ? "disabled" : ""}><div class="df-query-grid"><div class="field"><label for="df-query">Welche Daten suchst du?</label><input id="df-query" name="query" maxlength="200" placeholder="Zum Beispiel: Wo finde ich die Adressen der Kunden?" value="${e(state.dfQuery)}"></div><div class="field"><label for="df-value">Beispielwert (optional)</label><input id="df-value" name="value" maxlength="200" placeholder="Zum Beispiel Musterstraße 33" value="${e(state.dfValue)}" autocomplete="off"></div><div class="field"><label for="df-source">Datenquelle</label><select id="df-source" name="source"><option value="all">Alle freigegebenen Quellen</option>${state.sources.map((s) => `<option value="${s.id}" ${String(s.id) === String(state.dfSource) ? "selected" : ""}>${e(s.name)}</option>`).join("")}</select></div></div><button class="btn primary" type="submit">Tabellen vorschlagen</button></fieldset></form><p class="small muted">Dieser Schritt verwendet nur die gespeicherte Dokumentation und liest keine Datenwerte.</p><div id="df-error" class="error-text" role="alert">${e(state.dfError)}</div></section><div id="df-candidates">${d ? localize`<section class="panel df-panel"><div class="panel-head"><div><h2>${e(uiText("{0} mögliche Tabellen / Collections", d.total))}</h2><p class="small muted">${d.recognized_terms.length ? e(uiText("Erkannte Begriffe: {0}", d.recognized_terms.join(", "))) : e(uiText("Suche nach dokumentierten Namen und Beschreibungen"))}</p></div></div>${d.unscanned_sources ? `<p class="hint">${e(uiText("{0} Quellen haben noch keinen Struktur-Scan.", d.unscanned_sources))}</p>` : ""}<div class="df-candidate-list" data-page="${d.page}">${d.candidates.map((c, i) => finderCandidate(c, i)).join("")}</div>${!d.candidates.length ? localize('<div class="panel-body"><p>Keine passenden Objekte gefunden. Versuche andere Begriffe, ergänze Kommentare oder bestätigte Fachbegriffe, oder aktualisiere den Struktur-Scan.</p></div>') : ""}<div class="catalog-pagination"><span class="muted small">${e(uiText("Seite {0} von {1}", d.page, Math.max(1, Math.ceil(d.total / d.page_size))))}</span><div class="actions">${dfButton("Zurück", "page", d.page - 1, d.page <= 1 || state.dfBusy ? "disabled" : "")}${dfButton("Weiter", "page", d.page + 1, d.page * d.page_size >= d.total || state.dfBusy ? "disabled" : "")}</div></div></section>` : ""}</div>${d ? localize`<section class="panel panel-body df-panel"><h2>2. Beispielwert gezielt suchen</h2><p>Wähle oben die Tabellen und Textspalten aus, die geprüft werden sollen. Pro Suche sind maximal fünf Objekte und zehn Spalten möglich.</p><p class="small muted">${e(uiText("Ausgewählt: {0} Objekte, {1} Textspalten", selected.length, count))}</p>${selected.map((c, i) => `<div class="df-selected"><span>${e(c.source_name)} · ${e(c.table_name)} · ${e(c.columns.join(", ") || uiText("Keine Spalte ausgewählt"))}</span>${dfButton("Auswahl entfernen", "remove", i, state.dfBusy ? "disabled" : "")}</div>`).join("")}<form id="df-values-form"><fieldset ${state.dfBusy ? "disabled" : ""}><div class="field"><label for="df-example">Zu suchender Beispielwert</label><input id="df-example" name="value" maxlength="200" value="${e(state.dfValue)}" required autocomplete="off"></div><div class="field"><label for="df-compare">Vergleich</label><select id="df-compare" name="mode"><option value="exact" ${state.dfMode === "exact" ? "selected" : ""}>Gleich dem Beispielwert</option><option value="contains" ${state.dfMode === "contains" ? "selected" : ""}>Enthält den Beispielwert</option></select></div><button class="btn primary" type="submit" ${!selected.length || count === 0 || count > 10 || selected.length > 5 ? "disabled" : ""}>Beispielwert suchen</button></fieldset></form><p class="small muted">Die Suche verwendet parametrisierte Leseabfragen mit einem Zeitbudget pro Spalte und pro Suche. Auch eine gezielte Suche kann auf großen Tabellen Arbeit verursachen. Der Vergleich folgt den Regeln der jeweiligen Datenbank; bei MongoDB ist „Enthält“ groß-/kleinschreibungssensitiv.</p><p class="small muted">Es werden nur Fundorte angezeigt. Beispielwerte und Ergebnisse werden in DatabaseDoc weder gespeichert noch in URLs oder Anwendungslogs geschrieben. Straße und Hausnummer können in getrennten Feldern liegen; suche dann beispielsweise nur nach dem Straßennamen.</p><div id="df-value-error" class="error-text" role="alert"></div>${state.dfBusy ? localize('<p class="hint" role="status">Suche läuft …</p>') : ""}</section>` : ""}<div id="df-results">${finderResults()}</div>`,
  );
  const list = document.querySelector(".df-candidate-list");
  if (list) list.scrollTop = previousScroll;
  if (focus?.startsWith("df-"))
    document.getElementById(focus)?.focus({ preventScroll: true });
}
function finderCandidate(c, i) {
  const s = state.dfSelection[dfKey(c)],
    disabled =
      state.dfBusy || !c.can_data || !c.columns.some((col) => col.searchable);
  return localize`<article class="df-candidate"><div class="df-object-head"><label class="checkbox"><input type="checkbox" id="df-object-${i}" data-df-object="${i}" ${s ? "checked" : ""} ${disabled ? "disabled" : ""}><strong>${e(c.source_name)} · ${e([c.schema, c.table_name].filter(Boolean).join("."))}</strong></label>${dfButton("Dokumentation öffnen", "open", i)}</div><p class="small muted">${e(uiText("Datenbank: {0}", c.database_name))}</p><p class="small muted">${c.matched_terms.length ? e(uiText("Hinweise im Objekt: {0}", c.matched_terms.join(", "))) : e(uiText("Passende dokumentierte Namen oder Beschreibungen"))}${c.related_terms.length ? " · " + e(uiText("Zusammenhang über Beziehungen: {0}", c.related_terms.join(", "))) : ""}</p>${c.concepts.length ? `<p class="small">${e(uiText("Bestätigte Fachbegriffe: {0}", c.concepts.join(", ")))}</p>` : ""}${c.related_tables.length ? `<p class="small muted">${e(uiText("Verknüpfte Tabellen: {0}", c.related_tables.join(", ")))}</p>` : ""}<details ${s ? "open" : ""}><summary>Textspalten für die Beispielsuche auswählen</summary><fieldset class="df-fields" ${state.dfBusy ? "disabled" : ""}>${c.columns
    .filter((col) => col.searchable)
    .map(
      (col, j) =>
        `<label class="checkbox" for="df-column-${i}-${j}"><input id="df-column-${i}-${j}" type="checkbox" data-df-column="${i}" data-column="${e(col.name)}" ${s?.columns.includes(col.name) ? "checked" : ""} ${!s ? "disabled" : ""}><span>${e(col.name)}${col.matched ? " · " + e(uiText("Begriff passt")) : ""}<small class="muted">${e(col.type)}</small></span></label>`,
    )
    .join(
      "",
    )}${!c.columns.some((col) => col.searchable) ? localize('<p class="small muted">Keine gescannten Textfelder. Bei MongoDB gegebenenfalls die Feldableitung aktivieren.</p>') : ""}</fieldset></details>${!c.can_data ? localize('<p class="small muted">Für die Beispielsuche ist die separate Datenberechtigung erforderlich.</p>') : ""}</article>`;
}
function finderResults() {
  const r = state.dfResults;
  if (!r) return "";
  const labels = {
    found: "Wert gefunden",
    not_found: "Kein Treffer im geprüften Feld",
    error: "Prüfung fehlgeschlagen",
    not_checked: "Wegen Zeitbudget nicht geprüft",
  };
  return localize`<section class="panel df-panel"><div class="panel-head"><div><h2>3. Fundorte prüfen</h2><p class="small muted">${e(uiText("{0} Spalten geprüft, {1} Spalten mit Treffern", r.checked_columns, r.found_columns))}</p></div></div><div class="panel-body"><p>Ein Treffer bestätigt den Beispielwert in diesem Feld. Die fachliche Bedeutung und die Zugehörigkeit zu einem bestimmten Kunden müssen zusätzlich geprüft werden.</p>${r.incomplete ? localize('<p class="hint">Die Suche ist unvollständig. Fehlgeschlagene oder nicht geprüfte Felder erlauben keine Aussage darüber, ob der Wert vorhanden ist.</p>') : ""}</div>${r.results.map((t, i) => `<article class="df-candidate"><div class="df-object-head"><strong>${e(t.source_name)} · ${e([t.schema, t.table_name].filter(Boolean).join("."))}</strong>${dfButton("Tabelle öffnen", "result-open", i)}</div><p class="small muted">${e(uiText("Datenbank: {0}", t.database_name))}</p>${t.columns.map((c, j) => `<div class="df-result-line"><button type="button" class="text-button" data-action="df-column-open" data-index="${i}" data-column-index="${j}">${e(c.name)}</button><span class="badge ${c.status === "found" ? "ready" : c.status === "error" ? "error" : "neutral"}">${e(uiText(labels[c.status]))}</span></div>${c.message ? `<p class="hint">${e(c.message)}</p>` : ""}`).join("")}</article>`).join("")}</section>`;
}
async function finderSuggest(page = 1) {
  finderRemember();
  const id = state.user.id,
    run = (state.dfRunId = (state.dfRunId || 0) + 1);
  const request =
    page === 1
      ? {
          query: state.dfQuery,
          value_hint: state.dfValue,
          source_ids: state.dfSource === "all" ? [] : [Number(state.dfSource)],
        }
      : state.dfRequest;
  if (page === 1) {
    state.dfSelection = {};
    state.dfResults = null;
    state.dfRequest = request;
  }
  state.dfBusy = true;
  state.dfError = "";
  renderFinder();
  try {
    const data = await api("/api/finder/candidates", "POST", {
      ...request,
      page,
    });
    if (state.user?.id === id && run === state.dfRunId) state.dfData = data;
  } catch (error) {
    if (state.user?.id === id && run === state.dfRunId)
      state.dfError = error.message;
  } finally {
    if (state.user?.id === id && run === state.dfRunId) {
      state.dfBusy = false;
      if (state.view === "search" && state.searchMode === "finder")
        renderFinder();
    }
  }
}
async function finderSubmit(form) {
  if (form.id === "df-query-form") {
    await finderSuggest();
    return;
  }
  if (form.id !== "df-values-form") return;
  finderRemember();
  state.dfValue = new FormData(form).get("value");
  const targets = Object.values(state.dfSelection).map((c) => ({
    source_id: c.source_id,
    snapshot_id: c.snapshot_id,
    table_key: c.table_key,
    columns: c.columns,
  }));
  const id = state.user.id,
    run = (state.dfRunId = (state.dfRunId || 0) + 1);
  state.dfBusy = true;
  state.dfError = "";
  state.dfResults = null;
  renderFinder();
  try {
    const data = await api("/api/finder/values", "POST", {
      value: state.dfValue,
      mode: state.dfMode,
      targets,
    });
    if (state.user?.id === id && run === state.dfRunId) state.dfResults = data;
  } catch (error) {
    if (state.user?.id === id && run === state.dfRunId)
      state.dfError = error.message;
  } finally {
    if (state.user?.id === id && run === state.dfRunId) {
      state.dfBusy = false;
      if (state.view === "search" && state.searchMode === "finder")
        renderFinder();
    }
  }
}
async function finderClick(button) {
  const a = button.dataset.action,
    i = Number(button.dataset.index);
  if (a === "df-mode") {
    finderRemember();
    state.searchMode = button.dataset.mode;
    renderSearch();
    history.replaceState(
      null,
      "",
      state.searchMode === "finder" ? "#search?mode=finder" : "#search",
    );
    return;
  }
  if (a === "df-page") {
    await finderSuggest(i);
    return;
  }
  if (a === "df-remove") {
    finderRemember();
    const selected = Object.values(state.dfSelection);
    delete state.dfSelection[dfKey(selected[i])];
    state.dfResults = null;
    renderFinder();
    return;
  }
  let c;
  if (a === "df-open") c = state.dfData.candidates[i];
  if (a === "df-result-open" || a === "df-column-open")
    c = state.dfResults.results[i];
  if (c)
    await navigate("source", c.source_id, {
      table: c.table_key,
      ...(a === "df-column-open"
        ? { column: c.columns[Number(button.dataset.columnIndex)].name }
        : {}),
    });
}
function finderChange(input) {
  if (input.dataset.dfObject !== undefined) {
    finderRemember();
    const c = state.dfData.candidates[Number(input.dataset.dfObject)];
    if (input.checked)
      state.dfSelection[dfKey(c)] = { ...c, columns: [...c.default_columns] };
    else delete state.dfSelection[dfKey(c)];
    state.dfResults = null;
    renderFinder();
  }
  if (input.dataset.dfColumn !== undefined) {
    finderRemember();
    const c = state.dfData.candidates[Number(input.dataset.dfColumn)],
      s = state.dfSelection[dfKey(c)];
    if (!s) return;
    if (input.checked) s.columns.push(input.dataset.column);
    else s.columns = s.columns.filter((c) => c !== input.dataset.column);
    state.dfResults = null;
    renderFinder();
  }
  if (input.id === "df-source") {
    finderRemember();
    state.dfData = null;
    state.dfSelection = {};
    state.dfResults = null;
    renderFinder();
  }
  if (input.id === "df-compare") {
    state.dfMode = input.value;
    state.dfResults = null;
    document.getElementById("df-results").innerHTML = "";
  }
}
function finderInput(input) {
  if (!["df-query", "df-value", "df-example"].includes(input.id)) return;
  if (input.id === "df-query") state.dfQuery = input.value;
  else {
    state.dfValue = input.value;
    const other = document.getElementById(
      input.id === "df-value" ? "df-example" : "df-value",
    );
    if (other) other.value = input.value;
  }
  state.dfResults = null;
  const result = document.getElementById("df-results");
  if (result) result.innerHTML = "";
}
