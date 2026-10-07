// Source evidence, explicit aggregate profiles and confirmed cross-source mappings.
const analysisLabels = {
  structure: "Struktur",
  dwh: "DWH-Vorbereitung",
  profiles: "Datenprofile & Regeln",
  dependencies: "Abhängigkeiten",
};
const analysisRuleLabels = {
  not_null: "Keine NULL-Werte",
  not_empty: "Keine leeren Werte",
  unique: "Eindeutige Werte",
  range: "Numerischer Wertebereich",
  freshness: "Aktualität in Stunden",
};
const analysisResultLabels = {
  passed: "Bestanden im Abfragebestand",
  sample_passed: "In der Stichprobe bestanden",
  failed: "Verletzung festgestellt",
  inconclusive: "Stichprobe reicht nicht aus",
  not_checked: "Nicht geprüft",
};
function anButton(label, action, id = "", extra = "") {
  return `<button type="button" class="btn" data-action="an-${action}" data-id="${e(id)}" ${extra}>${e(uiText(label))}</button>`;
}
function anPages(page, total, action, size = 10) {
  const last = Math.max(1, Math.ceil(total / size));
  return `<div class="catalog-pagination"><span class="small muted">${e(uiText("Seite {0} von {1}", page, last))}</span><div class="actions">${anButton("Zurück", action, page - 1, page <= 1 ? "disabled" : "")}${anButton("Weiter", action, page + 1, page >= last ? "disabled" : "")}</div></div>`;
}
async function analysisLoadSource(reset = false) {
  state.sa = await api(`/api/sources/${state.source.id}/analysis`);
  if (reset) {
    state.saTab = "structure";
    state.saQuery = "";
    state.saPage = 1;
    state.saFindingPage = 1;
    state.saProfiles = [];
  }
  state.saTable = state.sa.tables.some((t) => t.table_key === state.saTable)
    ? state.saTable
    : state.sa.tables[0]?.table_key;
}
function analysisTable() {
  return state.sa?.tables.find((t) => t.table_key === state.saTable);
}
function sourceAnalysisView() {
  const r = state.sa;
  if (!r)
    return localize`<div class="panel panel-body"><p>Analyse wird geladen …</p></div>`;
  return localize`<section class="panel panel-body an-intro"><h2>Analyse der Datenquelle</h2><p>Struktur verstehen, DWH-Vorbereitung dokumentieren und Datenqualität gezielt prüfen.</p><p class="small muted">${r.snapshot_id ? e(uiText("Struktur-Scan #{0} vom {1}", r.snapshot_id, dt(r.scanned_at))) : e(uiText("Noch kein Struktur-Scan vorhanden. Zuerst die Datenquelle scannen."))}</p><div class="actions">${anButton("Analyse aktualisieren", "reload")}${anButton("Gemeinsame Fachbegriffe", "catalog")}</div></section><div class="wa-stats"><div><strong>${r.counts.objects}</strong><span>Objekte</span></div><div><strong>${r.counts.warnings}</strong><span>Struktur prüfen</span></div><div><strong>${r.counts.hints}</strong><span>Nächste Schritte</span></div></div>${r.findings
    .filter((f) => !f.table_key)
    .map((f) => `<p class="hint">${e(f.message)}</p>`)
    .join(
      "",
    )}${r.scan_warnings.map((w) => `<p class="hint">${e(uiMessage(w))}</p>`).join("")}<section class="panel"><div class="panel-head"><h2>Objekt auswählen</h2><input id="an-object-query" type="search" value="${e(state.saQuery || "")}" placeholder="Schema oder Objekt suchen …" aria-label="Objekte für die Analyse suchen"></div><div id="an-object-list"></div></section><div id="an-detail"></div>`;
}
function analysisPaint() {
  if (!state.sa || !document.getElementById("an-object-list")) return;
  const query = (state.saQuery || "").toLocaleLowerCase();
  const rows = state.sa.tables.filter((t) =>
    (t.schema + "." + t.name).toLocaleLowerCase().includes(query),
  );
  state.saPage = Math.min(
    state.saPage || 1,
    Math.max(1, Math.ceil(rows.length / 25)),
  );
  document.getElementById("an-object-list").innerHTML =
    localize`<div class="table-wrap"><table><thead><tr><th>Objekt</th><th>Typ</th><th>Zeilen (geschätzt)</th><th>Größe (Bytes)</th><th>DWH-Vorbereitung</th><th></th></tr></thead><tbody>${rows
      .slice((state.saPage - 1) * 25, state.saPage * 25)
      .map(
        (t) =>
          `<tr class="${t.table_key === state.saTable ? "search-highlight" : ""}"><td>${e([t.schema, t.name].filter(Boolean).join("."))}</td><td>${e(t.kind)}</td><td>${t.estimated_rows?.toLocaleString(uiLocale) ?? "—"}</td><td>${t.size_bytes?.toLocaleString(uiLocale) ?? "—"}</td><td>${Object.values(t.readiness).filter(Boolean).length}/4</td><td>${anButton("Analysieren", "select", t.table_key)}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div>${!rows.length ? localize('<p class="panel-body muted">Keine passenden Objekte.</p>') : ""}${anPages(state.saPage, rows.length, "objects-page", 25)}<p class="panel-body small muted">Größen und Zeilenanzahlen stammen aus optionalen Katalogstatistiken des Scans. Fehlende Werte sind unbekannt; Schätzungen sind keine exakten Zählungen.</p>`;
  const t = analysisTable();
  document.getElementById("an-detail").innerHTML = t
    ? localize`<section class="panel an-detail"><div class="panel-head"><div><div class="eyebrow">${e(t.schema)}</div><h2>${e(t.name)}</h2></div>${anButton("Tabellendokumentation öffnen", "documentation", t.table_key)}</div>${tabs(
        Object.entries(analysisLabels).map(([id, label]) => [
          id,
          uiText(label),
          id === "dependencies" ? "relations" : "table",
        ]),
        state.saTab || "structure",
        "an-tab",
      )}<div class="panel-body">${analysisDetail(t)}</div></section>`
    : "";
}
function analysisDetail(t) {
  if (state.saTab === "profiles") return analysisProfilesView(t);
  if (state.saTab === "dependencies") return analysisDependencies(t);
  if (state.saTab === "dwh") return analysisPreparation(t);
  const findings = state.sa.findings.filter((f) => f.table_key === t.table_key);
  state.saFindingPage = Math.min(
    state.saFindingPage || 1,
    Math.max(1, Math.ceil(findings.length / 20)),
  );
  return localize`<p class="muted">Hinweise basieren auf deklarierten Strukturen. Fehlende Fremdschlüssel oder Indizes sind Prüfhinweise und kein automatischer Beweis für einen Fehler.</p>${findings
    .slice((state.saFindingPage - 1) * 20, state.saFindingPage * 20)
    .map(
      (f) =>
        `<article class="wa-finding"><span class="badge ${f.severity === "warning" ? "error" : "neutral"}">${e(uiText(f.severity === "warning" ? "Struktur prüfen" : "Nächste Schritte"))}</span><p>${e(f.message)}${f.column ? ` <strong>${e(f.column)}</strong>` : ""}</p></article>`,
    )
    .join(
      "",
    )}${!findings.length ? localize("<p>Keine Strukturhinweise für dieses Objekt.</p>") : ""}${anPages(state.saFindingPage, findings.length, "findings-page", 20)}<div class="actions">${anButton("DWH-Vorbereitung", "tab", "dwh")}${anButton("Datenprofile & Regeln", "tab", "profiles")}</div>`;
}
function analysisPreparation(t) {
  const p = t.preparation;
  const checkLabels = {
    declared_key: "Deklarierter Schlüssel",
    grain: "Zeilenbedeutung dokumentiert",
    change_detection: "Ladeverfahren dokumentiert",
    delete_strategy: "Löschbehandlung dokumentiert",
  };
  return localize`<p>Vier Vorbereitungspunkte helfen bei der Planung. Sie ersetzen keine fachliche Freigabe oder einen getesteten Ladeprozess.</p><div class="an-checks">${Object.entries(
    t.readiness,
  )
    .map(
      ([k, v]) =>
        `<span class="badge ${v ? "" : "neutral"}">${v ? "✓" : "○"} ${e(uiText(checkLabels[k]))}</span>`,
    )
    .join(
      "",
    )}</div><p class="small muted">${e(uiText("Mögliche Änderungsspalten: {0}", t.change_candidates.join(", ") || "—"))}</p><form id="an-preparation-form"><fieldset ${state.source.can_edit ? "" : "disabled"}>${anSelect("Modellrolle", "role", { unknown: "Noch offen", fact: "Fakt", dimension: "Dimension", reference: "Referenzdaten", staging: "Staging" }, p.role || "unknown")}${anArea("Was beschreibt eine Zeile?", "grain", p.grain || "", 2000)}${anSelect("Ladeverfahren", "load_mode", { undecided: "Noch offen", full: "Vollständiges Laden", incremental: "Inkrementelles Laden" }, p.load_mode || "undecided")}${anSelect("Änderungsspalte", "change_column", { "": "Noch offen", ...Object.fromEntries(t.columns.map((c) => [c.name, c.name])) }, p.change_column || "", true)}${anArea("Wie werden Löschungen erkannt und behandelt?", "delete_strategy", p.delete_strategy || "", 2000)}${anArea("Fachliche Notizen", "notes", p.notes || "", 4000)}${state.source.can_edit ? '<button class="btn primary" type="submit">' + e(uiText("Vorbereitung speichern")) + "</button>" : ""}</fieldset><div id="an-form-error" class="error-text" role="alert"></div></form>`;
}
function anSelect(label, name, options, value, literal = false) {
  return `<div class="field"><label for="an-${name}">${e(uiText(label))}</label><select id="an-${name}" name="${name}">${Object.entries(
    options,
  )
    .map(
      ([k, v]) =>
        `<option value="${e(k)}" ${String(value) === k ? "selected" : ""}>${e(literal && k ? v : uiText(v))}</option>`,
    )
    .join("")}</select></div>`;
}
function anArea(label, name, value, max = 4000) {
  return `<div class="field"><label for="an-${name}">${e(uiText(label))}</label><textarea id="an-${name}" name="${name}" rows="3" maxlength="${max}">${e(value)}</textarea></div>`;
}
function analysisDependencies(t) {
  const upstream = [
    ...t.foreign_keys.map((f) => ({
      name: f.target_table,
      schema: f.target_schema,
      kind: "foreign_key",
    })),
    ...t.dependencies,
  ];
  const rows = (list) =>
    list.length
      ? `<ul>${list.map((d) => `<li><strong>${e([d.schema, d.name].filter(Boolean).join("."))}</strong> · ${e(uiText(d.kind === "foreign_key" ? "Fremdschlüssel" : "View-Abhängigkeit"))}</li>`).join("")}</ul>`
      : `<p class="muted">${e(uiText("Keine Abhängigkeiten im dokumentierten Umfang."))}</p>`;
  return localize`<h3>Verwendet andere Objekte</h3>${rows(upstream)}<h3 style="margin-top:24px">Wird verwendet von</h3>${rows(t.used_by)}<p class="hint">${e(uiText(t.dependency_status === "catalog" ? "View-Abhängigkeiten stammen aus dem Datenbankkatalog und betreffen nur Objekte innerhalb des gescannten Umfangs. Dynamisches SQL und externe Ladeprozesse werden nicht erfasst." : t.dependency_status === "not_scanned" ? "Für View-Abhängigkeiten und Größenstatistiken einen neuen Struktur-Scan starten." : "Für diesen Adapter oder diese Berechtigung sind keine View-Abhängigkeiten verfügbar. Deklarierte Fremdschlüssel werden weiterhin angezeigt."))}</p>`;
}
async function analysisLoadProfiles() {
  state.saProfiles =
    state.sa.can_data && analysisTable()
      ? await api(
          `/api/sources/${state.source.id}/analysis/profiles?${new URLSearchParams({ table_key: state.saTable })}`,
        )
      : [];
}
function analysisProfilesView(t) {
  const rules = state.sa.settings.rules.filter(
    (r) => r.table_key === t.table_key,
  );
  const history = state.saProfiles || [],
    selected = history.find((p) => p.id === state.saProfileId) || history[0];
  return localize`<h3>Datenprofil gezielt starten</h3><p>Ein Profil liest maximal die gewählte Anzahl erster Zeilen ohne garantierte Reihenfolge. Es ist keine repräsentative Zufallsstichprobe. Gespeichert werden nur aggregierte Ergebnisse, keine Rohzeilen oder häufigen Textwerte.</p>${!state.sa.can_data ? localize('<p class="hint">Für Datenprofile und ihre Ergebnisse ist die separate Datenberechtigung erforderlich.</p>') : !t.columns.length ? localize('<p class="hint">Keine gescannten Felder verfügbar. Bei MongoDB zuerst die Feldableitung aktivieren und neu scannen.</p>') : localize`<form id="an-profile-form"><div class="field"><label for="an-sample-limit">Maximal gelesene Zeilen</label><input id="an-sample-limit" name="sample_limit" type="number" min="100" max="5000" value="500" required></div><fieldset class="an-columns"><legend>Spalten auswählen (maximal 20)</legend>${t.columns.map((c, i) => `<label class="checkbox"><input type="checkbox" name="columns" value="${e(c.name)}" ${i < Math.min(8, t.columns.length) ? "checked" : ""}>${e(c.name)}</label>`).join("")}</fieldset><button type="submit" class="btn primary">Datenprofil starten</button><div id="an-form-error" class="error-text" role="alert"></div></form>`}<div class="section-title" style="margin-top:28px"><h3>Qualitätsregeln</h3>${state.source.can_edit && t.columns.length ? anButton("Regel hinzufügen", "rule-new") : ""}</div><p class="small muted">Regeln werden beim manuellen Datenprofil geprüft, nicht beim Struktur-Scan. Fehlende Werte und Eindeutigkeit sind getrennte Prüfungen.</p>${rules.map((r) => `<article class="wa-finding"><strong>${e(r.name)}</strong><p>${e(r.column)} · ${e(uiText(analysisRuleLabels[r.kind]))}${r.kind === "range" ? ` · ${e(r.minimum ?? "—")} … ${e(r.maximum ?? "—")}` : r.kind === "freshness" ? ` · ${e(r.max_age_hours)} h` : ""}</p>${state.source.can_edit ? anButton("Regel bearbeiten", "rule-edit", r.id) + anButton("Regel entfernen", "rule-remove", r.id) : ""}</article>`).join("")}${!rules.length ? localize('<p class="muted">Noch keine Qualitätsregeln.</p>') : ""}${state.sa.can_data ? localize`<h3 style="margin-top:28px">Profilverlauf</h3><p class="small muted">Die letzten 20 Profile je Objekt bleiben gespeichert. Scan- und Regelversion stehen bei jeder Prüfung fest.</p>${history.length ? `<div class="field"><label for="an-profile-history">${e(uiText("Prüfzeitpunkt auswählen"))}</label><select id="an-profile-history">${history.map((p) => `<option value="${p.id}" ${p.id === selected?.id ? "selected" : ""}>${e(dt(p.created))} · #${p.id}</option>`).join("")}</select></div>` : localize('<p class="muted">Noch kein Datenprofil gespeichert.</p>')}${selected ? analysisProfileResult(selected) : ""}` : ""}`;
}
function analysisProfileResult(saved) {
  const p = saved.profile;
  return localize`<section class="an-profile-result"><p><strong>${e(uiText(p.complete_read ? "Vollständiger Abfragebestand" : "Begrenzte Stichprobe"))}</strong> · ${p.row_count} ${uiText("Zeilen")} · ${e(dt(saved.created))} · ${e(uiText("Struktur-Scan #{0}", saved.snapshot_id))}</p>${saved.stale_schema || saved.stale_rules ? localize('<p class="hint">Scan oder Einstellungen haben sich seit diesem Profil geändert. Für aktuelle Entscheidungen ein neues Profil starten.</p>') : ""}<p class="small muted">Ergebnisse gelten für den gelesenen Bestand zum Prüfzeitpunkt. Eine bestandene Stichprobe beweist keine vollständige Datenqualität. Textwerte werden exakt und unter Beachtung der Groß-/Kleinschreibung verglichen, unabhängig von Datenbankkollationen. Zeitwerte ohne Zeitzone werden als UTC ausgewertet.</p><div class="table-wrap"><table><thead><tr><th>Spalte</th><th>NULL</th><th>Leer</th><th>Unterschiedliche Werte</th><th>Doppelte Nicht-NULL-Werte</th><th>Wertebereich</th><th>Text-/Binärlänge</th></tr></thead><tbody>${p.columns.map((c) => `<tr><td>${e(c.name)}</td><td>${c.null_count}${p.row_count ? ` (${((100 * c.null_count) / p.row_count).toLocaleString(uiLocale, { maximumFractionDigits: 1 })}%)` : ""}</td><td>${c.empty_count}</td><td>${c.distinct_non_null}</td><td>${c.duplicate_non_null}</td><td>${e(c.min_number ?? c.min_time ?? "—")} … ${e(c.max_number ?? c.max_time ?? "—")}</td><td>${c.min_length ?? "—"} … ${c.max_length ?? "—"}</td></tr>`).join("")}</tbody></table></div>${p.keys.map((k) => `<p>${e(uiText("Deklarierter Schlüssel {0}: {1} doppelte Zeilen, {2} Zeilen mit NULL im gelesenen Bestand.", k.columns.join(", "), k.duplicates, k.null_rows))}</p>`).join("")}<h3 style="margin-top:20px">Regelergebnisse</h3>${p.rules.map((r) => `<article class="wa-finding"><strong>${e(r.name)}</strong><p><span class="badge ${r.status === "failed" ? "error" : "neutral"}">${e(uiText(analysisResultLabels[r.status]))}</span> · ${e(r.column)}</p><p class="small muted">${e(uiText("Beobachtet: {0}", r.observed === null ? "—" : typeof r.observed === "object" ? JSON.stringify(r.observed) : String(r.observed)))}</p></article>`).join("")}${!p.rules.length ? localize('<p class="muted">Bei dieser Prüfung waren keine Regeln für das Objekt eingerichtet.</p>') : ""}</section>`;
}
function analysisRuleModal(id) {
  const t = analysisTable(),
    r = state.sa.settings.rules.find((r) => r.id === id) || {
      kind: "not_null",
      name: "",
      column: t.columns[0]?.name,
    };
  state.saEditingRule = id || null;
  openModal(
    uiText(id ? "Regel bearbeiten" : "Regel hinzufügen"),
    localize`<form id="an-rule-form">${field(uiText("Regelname"), "name", r.name, "text", 'required maxlength="190"')}${anSelect("Spalte", "column", Object.fromEntries(t.columns.map((c) => [c.name, c.name])), r.column, true)}${anSelect("Prüfung", "kind", analysisRuleLabels, r.kind)}<div id="an-rule-thresholds"></div><div id="an-form-error" class="error-text" role="alert"></div><div class="modal-footer"><button type="submit" class="btn primary">Regel speichern</button></div></form>`,
  );
  analysisRuleThresholds(r);
}
function analysisRuleThresholds(r = {}) {
  const kind = document.getElementById("an-kind")?.value;
  const node = document.getElementById("an-rule-thresholds");
  if (!node) return;
  node.innerHTML =
    kind === "range"
      ? `${field(uiText("Untergrenze"), "minimum", r.minimum ?? "", "number", 'step="any"')}${field(uiText("Obergrenze"), "maximum", r.maximum ?? "", "number", 'step="any"')}`
      : kind === "freshness"
        ? field(
            uiText("Maximales Alter (Stunden)"),
            "max_age_hours",
            r.max_age_hours ?? 24,
            "number",
            'required min="0.01" max="876000" step="any"',
          )
        : "";
}
async function analysisLoadCatalog() {
  state.analysisCatalog = await api("/api/analysis/catalog");
}
function renderAnalysisCatalog() {
  const c = state.analysisCatalog;
  shell(
    localize`<div class="page-head"><div><div class="eyebrow">Datenbankübergreifend</div><h1>Analyse & Fachbegriffe</h1><p>Finde gemeinsame Daten und dokumentiere bestätigte fachliche Zuordnungen für dein Warehouse.</p></div><div class="actions">${anButton("Analyse aktualisieren", "global-reload")}${c.can_create ? anButton("Fachbegriff anlegen", "concept-new") : ""}</div></div><div class="wa-stats"><div><strong>${c.sources.length}</strong><span>Freigegebene Quellen</span></div><div><strong>${c.sources.reduce((n, s) => n + s.objects, 0)}</strong><span>Dokumentierte Objekte</span></div><div><strong>${c.concepts.length}</strong><span>Bestätigte Fachbegriffe</span></div></div><section class="panel panel-body"><p>Ein Vorschlag basiert auf Namen und Datentypfamilien. Er beweist weder gleiche Inhalte noch gemeinsame Schlüssel. Bestätige Bedeutung, führendes System und Schlüsselübersetzung gemeinsam mit den Verantwortlichen.</p><input id="an-global-query" type="search" value="${e(state.analysisQuery || "")}" placeholder="Quelle, Fachbegriff oder Feld suchen …" aria-label="Analyse und Fachbegriffe filtern"></section><section class="panel an-catalog-panel"><div class="panel-head"><h2>Datenquellen analysieren</h2></div><div id="an-global-sources"></div></section><section class="panel an-catalog-panel"><div class="panel-head"><h2>Bestätigte Fachbegriffe</h2></div><div id="an-concepts"></div></section><section class="panel an-catalog-panel"><div class="panel-head"><h2>Mögliche gemeinsame Daten</h2></div><div id="an-suggestions"></div></section>${c.suggestions_truncated ? localize('<p class="hint">Die Vorschlagsliste wurde für die Übersicht begrenzt. Alle Quellen bleiben dokumentiert. Weitere Zuordnungen lassen sich manuell anlegen.</p>') : ""}`,
  );
  analysisGlobalPaint();
}
function analysisGlobalPaint() {
  if (!document.getElementById("an-concepts")) return;
  const c = state.analysisCatalog,
    q = (state.analysisQuery || "").toLocaleLowerCase();
  const matches = (value) => value.toLocaleLowerCase().includes(q);
  const sources = c.sources.filter((s) => matches(s.name));
  state.anSourcesPage = Math.min(
    state.anSourcesPage || 1,
    Math.max(1, Math.ceil(sources.length / 10)),
  );
  document.getElementById("an-global-sources").innerHTML =
    localize`<div class="table-wrap"><table><thead><tr><th>Datenquelle</th><th>Objekte</th><th>Letzter Scan</th><th></th></tr></thead><tbody>${sources
      .slice((state.anSourcesPage - 1) * 10, state.anSourcesPage * 10)
      .map(
        (s) =>
          `<tr><td>${e(s.name)}</td><td>${s.objects}</td><td>${e(dt(s.scanned_at))}</td><td>${anButton("Analysieren", "source", s.id)}</td></tr>`,
      )
      .join(
        "",
      )}</tbody></table></div>${anPages(state.anSourcesPage, sources.length, "sources-page")}`;
  const concepts = c.concepts.filter((r) =>
    matches(
      r.name +
        " " +
        r.definition +
        " " +
        r.bindings.map((b) => b.source_name + " " + b.column).join(" "),
    ),
  );
  state.anConceptsPage = Math.min(
    state.anConceptsPage || 1,
    Math.max(1, Math.ceil(concepts.length / 10)),
  );
  document.getElementById("an-concepts").innerHTML =
    `<div class="panel-body">${concepts
      .slice((state.anConceptsPage - 1) * 10, state.anConceptsPage * 10)
      .map(
        (r) =>
          `<article class="wa-finding"><h3>${e(r.name)}</h3><p class="an-literal">${e(r.definition)}</p><p class="small muted">${e(uiText("Verantwortlich"))}: ${e(r.owner || "—")}</p><ul>${r.bindings.map((b, i) => `<li>${i === r.leading_binding ? `<strong>${e(uiText("Führendes System"))}: </strong>` : ""}${e(b.source_name)} · ${e(b.table_name)}.${e(b.column)} ${b.state !== "current" ? `<span class="badge error">${e(uiText(b.state === "missing" ? "Feld fehlt im aktuellen Scan" : "Datentyp geändert"))}</span>` : ""}${b.transformation ? `<p class="an-literal small">${e(b.transformation)}</p>` : ""}${anButton("Struktur öffnen", "binding-open", r.id, `data-index="${i}"`)}</li>`).join("")}</ul>${r.can_edit ? anButton("Fachbegriff bearbeiten", "concept-edit", r.id) + anButton("Fachbegriff entfernen", "concept-remove", r.id) : ""}</article>`,
      )
      .join(
        "",
      )}${!concepts.length ? `<p class="muted">${e(uiText("Noch keine sichtbaren Fachbegriffe."))}</p>` : ""}</div>${anPages(state.anConceptsPage, concepts.length, "concepts-page")}`;
  const candidates = c.suggestions
    .map((s, index) => ({ ...s, index }))
    .filter((s) =>
      matches(
        s.name +
          " " +
          s.bindings
            .map((b) => b.source_name + " " + b.table_name + " " + b.column)
            .join(" "),
      ),
    );
  state.anSuggestionsPage = Math.min(
    state.anSuggestionsPage || 1,
    Math.max(1, Math.ceil(candidates.length / 10)),
  );
  document.getElementById("an-suggestions").innerHTML =
    `<div class="panel-body">${candidates
      .slice((state.anSuggestionsPage - 1) * 10, state.anSuggestionsPage * 10)
      .map(
        (s) =>
          `<article class="wa-finding"><h3>${e(s.name)}</h3><p class="small muted">${e(uiText(s.kind === "entity" ? "Ähnliche fachliche Objektnamen" : "Gleicher normalisierter Feldname"))} · ${e(s.type_family)}</p><ul>${s.bindings
            .slice(0, 6)
            .map(
              (b) =>
                `<li>${e(b.source_name)} · ${e(b.table_name)}.${e(b.column)} · ${e(b.data_type)}</li>`,
            )
            .join(
              "",
            )}</ul><p class="small muted">${e(uiText("{0} mögliche Feldzuordnungen", s.bindings.length))}</p>${c.can_create && s.can_confirm !== false ? anButton("Als Fachbegriff prüfen", "suggestion", s.index) : ""}</article>`,
      )
      .join(
        "",
      )}${!candidates.length ? `<p class="muted">${e(uiText("Keine gemeinsamen Kandidaten in den freigegebenen Scans. Zuordnungen können manuell angelegt werden."))}</p>` : ""}</div>${anPages(state.anSuggestionsPage, candidates.length, "suggestions-page")}`;
}
function analysisConceptDraft() {
  const f = document.getElementById("an-concept-form"),
    d = state.anConceptDraft;
  if (!f) return;
  d.name = f.elements.name.value;
  d.definition = f.elements.definition.value;
  d.owner = f.elements.owner.value;
  d.leading_binding =
    f.elements.leading?.value === "" ? null : Number(f.elements.leading?.value);
  d.bindings.forEach(
    (b, i) =>
      (b.transformation = f.elements["transformation-" + i]?.value || ""),
  );
}
function analysisConceptModal(id, suggestion) {
  const r = state.analysisCatalog.concepts.find((c) => c.id === Number(id));
  state.anConceptId = r?.id || null;
  state.anConceptDraft = r
    ? JSON.parse(JSON.stringify(r))
    : {
        name: suggestion?.name || "",
        definition: "",
        owner: "",
        leading_binding: null,
        bindings: (suggestion?.bindings || []).map((b) => ({
          ...b,
          transformation: "",
        })),
      };
  state.anBindingSnapshot = null;
  analysisConceptRender();
}
function analysisConceptRender() {
  const d = state.anConceptDraft;
  openModal(
    uiText(
      state.anConceptId ? "Fachbegriff bearbeiten" : "Fachbegriff anlegen",
    ),
    localize`<form id="an-concept-form">${field(uiText("Fachbegriff"), "name", d.name, "text", 'required maxlength="190"')}${anArea("Fachliche Definition", "definition", d.definition)}${field(uiText("Verantwortlich"), "owner", d.owner, "text", 'maxlength="190"')}<p class="small muted">Speichern bestätigt diese Zuordnungen. Unterschiedliche IDs benötigen eine dokumentierte Übersetzung; gleiche Datentypen beweisen keine gemeinsame Identität.</p><div class="field"><label for="an-leading">Führendes System</label><select id="an-leading" name="leading"><option value="">${e(uiText("Noch offen"))}</option>${d.bindings.map((b, i) => `<option value="${i}" ${i === d.leading_binding ? "selected" : ""}>${e(b.source_name || state.sources.find((s) => s.id === b.source_id)?.name || "")} · ${e(b.table_name)}.${e(b.column)}</option>`).join("")}</select></div><div class="an-binding-list">${d.bindings.map((b, i) => `<article class="wa-finding"><strong>${e(b.source_name || state.sources.find((s) => s.id === b.source_id)?.name || "")} · ${e(b.table_name)}.${e(b.column)}</strong><div class="field"><label for="an-transform-${i}">${e(uiText("Schlüsselübersetzung / Transformation"))}</label><textarea id="an-transform-${i}" name="transformation-${i}" maxlength="2000" rows="2">${e(b.transformation || "")}</textarea></div>${b.state ? `<p class="small muted">${e(b.data_type)}${b.current_type && b.current_type !== b.data_type ? " → " + e(b.current_type) : ""} · ${e(uiText(b.confirm_current ? "Wird beim Speichern mit dem aktuellen Scan bestätigt" : b.state === "missing" ? "Feld fehlt im aktuellen Scan" : b.state === "changed" ? "Datentyp geändert" : "Zuordnung unverändert"))}</p>${b.state !== "missing" ? anButton("Mit aktuellem Scan bestätigen", "binding-current", i) : ""}` : ""}${anButton("Zuordnung entfernen", "binding-remove", i)}</article>`).join("")}</div><h3>Feldzuordnung hinzufügen</h3>${anSelect("Datenquelle", "binding_source", { "": "Bitte auswählen", ...Object.fromEntries(state.sources.filter((s) => s.can_edit && s.snapshot_id).map((s) => [s.id, s.name])) }, "", true)}<div id="an-binding-fields"></div><div id="an-form-error" class="error-text" role="alert"></div><div class="modal-footer"><button class="btn primary" type="submit">Fachbegriff speichern</button></div></form>`,
  );
}
async function analysisBindingSource() {
  const id = document.getElementById("an-binding_source").value;
  const node = document.getElementById("an-binding-fields");
  node.innerHTML = "";
  state.anBindingSnapshot = null;
  if (!id) return;
  const snap = await api(`/api/sources/${id}/snapshot`);
  if (document.getElementById("an-binding_source")?.value !== id) return;
  state.anBindingSnapshot = { ...snap, source_id: Number(id) };
  node.innerHTML =
    anSelect(
      "Objekt",
      "binding_table",
      {
        "": "Bitte auswählen",
        ...Object.fromEntries(
          snap.payload.tables.map((t) => [
            t.key,
            [t.schema, t.name].filter(Boolean).join("."),
          ]),
        ),
      },
      "",
      true,
    ) + '<div id="an-binding-column"></div>';
}
function analysisBindingTable() {
  const key = document.getElementById("an-binding_table").value,
    t = state.anBindingSnapshot?.payload.tables.find((t) => t.key === key);
  document.getElementById("an-binding-column").innerHTML = t
    ? anSelect(
        "Spalte",
        "binding_column",
        {
          "": "Bitte auswählen",
          ...Object.fromEntries(t.columns.map((c) => [c.name, c.name])),
        },
        "",
        true,
      ) + anButton("Feld hinzufügen", "binding-add")
    : "";
}
async function analysisClick(button) {
  const action = button.dataset.action.slice(3),
    id = button.dataset.id;
  if (action === "catalog") {
    await navigate("analysis");
    return;
  }
  if (action === "source") {
    await navigate("source", id, { tab: "analysis" });
    return;
  }
  if (action === "reload") {
    await loadSources();
    state.source = state.sources.find((s) => s.id === state.source.id);
    await analysisLoadSource();
    if (state.saTab === "profiles") await analysisLoadProfiles();
    renderSource();
    return;
  }
  if (action === "select") {
    state.saTable = id;
    state.saFindingPage = 1;
    state.saProfileId = null;
    if (state.saTab === "profiles") await analysisLoadProfiles();
    analysisPaint();
    return;
  }
  if (action === "tab") {
    state.saTab = button.dataset.tab || id;
    state.saProfileId = null;
    if (state.saTab === "profiles") await analysisLoadProfiles();
    analysisPaint();
    return;
  }
  if (action === "documentation") {
    await navigate("source", state.source.id, { table: id });
    return;
  }
  if (action === "objects-page") {
    state.saPage = Number(id);
    analysisPaint();
    return;
  }
  if (action === "findings-page") {
    state.saFindingPage = Number(id);
    analysisPaint();
    return;
  }
  if (action === "rule-new" || action === "rule-edit") {
    analysisRuleModal(action === "rule-edit" ? id : null);
    return;
  }
  if (action === "rule-remove") {
    if (!confirm(uiText("Diese Qualitätsregel entfernen?"))) return;
    await api(`/api/sources/${state.source.id}/analysis/rules`, "PUT", {
      version: state.sa.settings.version,
      rules: state.sa.settings.rules.filter((r) => r.id !== id),
    });
    await analysisLoadSource();
    await analysisLoadProfiles();
    analysisPaint();
    return;
  }
  if (action === "global-reload") {
    await analysisLoadCatalog();
    renderAnalysisCatalog();
    return;
  }
  const globalPages = {
    "sources-page": "anSourcesPage",
    "concepts-page": "anConceptsPage",
    "suggestions-page": "anSuggestionsPage",
  };
  if (globalPages[action]) {
    state[globalPages[action]] = Number(id);
    analysisGlobalPaint();
    return;
  }
  if (action === "concept-new" || action === "concept-edit") {
    analysisConceptModal(action === "concept-edit" ? id : null);
    return;
  }
  if (action === "suggestion") {
    analysisConceptModal(null, state.analysisCatalog.suggestions[Number(id)]);
    return;
  }
  if (action === "concept-remove") {
    if (
      !confirm(
        uiText("Fachbegriff und seine dokumentierten Zuordnungen entfernen?"),
      )
    )
      return;
    const c = state.analysisCatalog.concepts.find((c) => c.id === Number(id));
    await api(`/api/analysis/concepts/${id}`, "DELETE", { version: c.version });
    await analysisLoadCatalog();
    renderAnalysisCatalog();
    return;
  }
  if (action === "binding-open") {
    const b = state.analysisCatalog.concepts.find((c) => c.id === Number(id))
      .bindings[Number(button.dataset.index)];
    await navigate("source", b.source_id, {
      table: b.table_key,
      column: b.column,
    });
    return;
  }
  if (action === "binding-current") {
    analysisConceptDraft();
    state.anConceptDraft.bindings[Number(id)].confirm_current = true;
    analysisConceptRender();
    return;
  }
  if (action === "binding-remove") {
    analysisConceptDraft();
    const i = Number(id),
      d = state.anConceptDraft;
    d.bindings.splice(i, 1);
    d.leading_binding =
      d.leading_binding === i
        ? null
        : d.leading_binding > i
          ? d.leading_binding - 1
          : d.leading_binding;
    analysisConceptRender();
    return;
  }
  if (action === "binding-add") {
    const snap = state.anBindingSnapshot,
      t = snap?.payload.tables.find(
        (t) => t.key === document.getElementById("an-binding_table").value,
      ),
      column = document.getElementById("an-binding_column")?.value;
    if (!t || !column)
      throw new Error(uiText("Bitte eine gescannte Spalte auswählen."));
    analysisConceptDraft();
    const d = state.anConceptDraft;
    if (d.bindings.length >= 40)
      throw new Error(uiText("Bis zu 40 Zuordnungen je Fachbegriff."));
    if (
      d.bindings.some(
        (b) =>
          b.source_id === snap.source_id &&
          b.table_key === t.key &&
          b.column === column,
      )
    )
      throw new Error(uiText("Diese Zuordnung ist bereits vorhanden."));
    d.bindings.push({
      confirm_current: true,
      source_id: snap.source_id,
      source_name: state.sources.find((s) => s.id === snap.source_id).name,
      table_key: t.key,
      table_name: t.name,
      column,
      transformation: "",
    });
    analysisConceptRender();
  }
}
async function analysisSubmit(form) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === "an-preparation-form") {
      await api(`/api/sources/${state.source.id}/analysis/preparation`, "PUT", {
        ...data,
        version: state.sa.settings.version,
        table_key: state.saTable,
      });
      await analysisLoadSource();
      analysisPaint();
      toast(uiText("DWH-Vorbereitung gespeichert."));
    }
    if (form.id === "an-rule-form") {
      const rule = {
        id: state.saEditingRule || undefined,
        table_key: state.saTable,
        column: data.column,
        name: data.name,
        kind: data.kind,
        minimum: data.minimum ? Number(data.minimum) : null,
        maximum: data.maximum ? Number(data.maximum) : null,
        max_age_hours: data.max_age_hours ? Number(data.max_age_hours) : null,
      };
      const rules = state.sa.settings.rules.filter(
        (r) => r.id !== state.saEditingRule,
      );
      rules.push(rule);
      await api(`/api/sources/${state.source.id}/analysis/rules`, "PUT", {
        version: state.sa.settings.version,
        rules,
      });
      modal.close();
      await analysisLoadSource();
      await analysisLoadProfiles();
      analysisPaint();
      toast(uiText("Qualitätsregel gespeichert."));
    }
    if (form.id === "an-profile-form") {
      const columns = new FormData(form).getAll("columns");
      if (!columns.length || columns.length > 20)
        throw new Error(uiText("Zwischen 1 und 20 Spalten auswählen."));
      const p = await api(
        `/api/sources/${state.source.id}/analysis/profiles`,
        "POST",
        {
          table_key: state.saTable,
          snapshot_id: state.sa.snapshot_id,
          settings_version: state.sa.settings.version,
          sample_limit: Number(data.sample_limit),
          columns,
        },
      );
      await analysisLoadProfiles();
      state.saProfileId = p.id;
      analysisPaint();
      toast(uiText("Datenprofil gespeichert."));
    }
    if (form.id === "an-concept-form") {
      analysisConceptDraft();
      const d = state.anConceptDraft;
      await api(
        state.anConceptId
          ? `/api/analysis/concepts/${state.anConceptId}`
          : "/api/analysis/concepts",
        state.anConceptId ? "PUT" : "POST",
        {
          name: d.name,
          definition: d.definition,
          owner: d.owner,
          leading_binding: d.leading_binding,
          version: d.version,
          bindings: d.bindings.map(
            ({
              source_id,
              table_key,
              column,
              transformation,
              confirm_current,
            }) => ({
              source_id,
              table_key,
              column,
              transformation: transformation || "",
              confirm_current: Boolean(confirm_current),
            }),
          ),
        },
      );
      modal.close();
      await analysisLoadCatalog();
      renderAnalysisCatalog();
      toast(uiText("Fachbegriff gespeichert."));
    }
  } catch (error) {
    const node = form.querySelector("#an-form-error");
    if (node) node.textContent = error.message;
    else toast(error.message);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
function analysisInput(target) {
  if (target.id === "an-object-query") {
    state.saQuery = target.value;
    state.saPage = 1;
    analysisPaint();
  }
  if (target.id === "an-global-query") {
    state.analysisQuery = target.value;
    state.anSourcesPage = state.anConceptsPage = state.anSuggestionsPage = 1;
    analysisGlobalPaint();
  }
}
async function analysisChange(target) {
  try {
    if (target.id === "an-kind") analysisRuleThresholds();
    if (target.id === "an-profile-history") {
      state.saProfileId = Number(target.value);
      analysisPaint();
    }
    if (target.id === "an-binding_source") await analysisBindingSource();
    if (target.id === "an-binding_table") analysisBindingTable();
  } catch (error) {
    toast(error.message);
  }
}
