"use strict";
const whTaskKinds = {
  implementation: uiText("Umsetzung"),
  quality: uiText("Datenqualität"),
  operations: uiText("Betrieb"),
};
const whTaskStatuses = {
  open: uiText("Offen"),
  in_progress: uiText("In Bearbeitung"),
  done: uiText("Erledigt"),
};
const whTabs = [
  ["overview", uiText("Fahrplan")],
  ["areas", uiText("Teilprojekte")],
  ["model", uiText("Gesamtmodell")],
  ["lineage", uiText("Datenherkunft")],
  ["check", uiText("Zielabgleich")],
  ["operations", uiText("Betreuung")],
];

function whButton(label, action, id = "", primary = false, disabled = false) {
  return `<button type="button" class="btn ${primary ? "primary" : ""}" data-action="wh-${e(action)}" data-id="${e(id)}" ${disabled ? "disabled" : ""}>${e(uiText(label))}</button>`;
}
function whSet(workspace) {
  state.wh = workspace;
  state.dwhProject = workspace.project;
  state.dwhComparison = null;
}
async function whRefresh() {
  await loadSources();
  whSet(await api(`/api/dwh/warehouses/${state.wh.id}`));
  renderWarehouseWorkspace();
}
function renderWarehouseHub() {
  const warehouses = state.whWarehouses || [];
  const projects = state.dwhProjects.filter((project) => !project.warehouse_id);
  shell(localize`<div class="page-head"><div><div class="eyebrow">Vom Quellsystem zum Zielmodell</div><h1>DWH-Projekte</h1><p>${e(uiText("Ein zentrales Warehouse, gemeinsame Tabellen und fachliche Teilprojekte."))}</p></div>${state.user.role !== "viewer" ? whButton("Zentrales Warehouse anlegen", "create", "", true) : ""}</div>
    <section class="panel panel-body wh-welcome"><h2>${e(uiText("Dein Einstieg ins Data Warehouse"))}</h2><p>${e(uiText("Beginne mit einer konkreten Frage, etwa täglichem Umsatz nach Produkt. Lege ein Warehouse an und ergänze darin ein Teilprojekt. Gemeinsame Dimensionen werden einmal geplant und von mehreren Teilprojekten genutzt."))}</p><ol class="wh-mini-roadmap">${["Warehouse einrichten", "Teilprojekt beschreiben", "Tabellen und Datenherkunft planen", "Umsetzen und betreuen"].map((label, index) => `<li><span>${index + 1}</span>${e(uiText(label))}</li>`).join("")}</ol><p class="small muted">${e(uiText("DatabaseDoc plant und dokumentiert. SQL und Ladejobs führt ihr im Zielsystem aus; der Assistent zeigt die nötigen Schritte."))}</p></section>
    <section class="wh-card-grid">${warehouses.map((workspace) => `<article class="panel panel-body"><div class="eyebrow">${e(dwhEngines[workspace.project.target_kind])} · ${e(workspace.project.target_schema)}</div><h2>${e(workspace.project.name)}</h2><p class="wh-excerpt">${e(workspace.project.goal)}</p><div class="tag-list"><span class="tag">${e(uiText("{0} Teilprojekte", workspace.areas.length))}</span><span class="tag">${e(uiText("{0} zentrale Tabellen", workspace.project.table_count))}</span></div>${whButton("Warehouse öffnen", "open", workspace.id, true)}</article>`).join("")}</section>
    <section class="panel"><div class="panel-head"><div><h2>${e(uiText("Eigenständige Projekte"))}</h2><p class="small muted">${e(uiText("Bestehende Projekte bleiben erhalten. Du kannst eines als Warehouse verwenden oder seine Planung in ein Warehouse übernehmen."))}</p></div>${state.user.role !== "viewer" ? `<button class="btn" data-action="dwh-create">${e(uiText("Projekt anlegen"))}</button>` : ""}</div><div class="table-wrap"><table><thead><tr><th>${e(uiText("Projekt / Ziel"))}</th><th>${e(uiText("Plattform"))}</th><th>${e(uiText("Zieltabellen"))}</th><th></th></tr></thead><tbody>${projects.map((project) => `<tr><td><strong>${e(project.name)}</strong><p class="small muted">${e(project.goal)}</p></td><td>${e(dwhEngines[project.target_kind])}</td><td>${project.table_count}</td><td><div class="actions"><button class="btn" data-action="dwh-open" data-id="${project.id}">${e(uiText("Projekt öffnen →"))}</button>${project.can_edit ? whButton("Als Warehouse verwenden", "convert", project.id) : ""}</div></td></tr>`).join("") || `<tr><td colspan="4">${e(uiText("Keine eigenständigen Projekte vorhanden."))}</td></tr>`}</tbody></table></div></section>`);
}
function whAreaUsage(tableId) {
  return state.wh.areas.filter((area) => area.table_ids.includes(tableId));
}
function whVisibleTables() {
  const area = state.wh.areas.find((area) => area.id === state.whAreaFilter);
  const query = (state.whQuery || "").trim().toLowerCase();
  return state.dwhProject.tables.filter(
    (table) =>
      (!area || area.table_ids.includes(table.id)) &&
      (!query ||
        [
          table.name,
          table.description,
          ...table.columns.map((column) => column.name),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query)),
  );
}
function whScopeControls() {
  return `<div class="wh-filters"><div class="field"><label for="wh-filter">${e(uiText("Teilprojekt filtern"))}</label><select id="wh-filter"><option value="">${e(uiText("Alle Teilprojekte"))}</option>${state.wh.areas.map((area) => `<option value="${area.id}" ${state.whAreaFilter === area.id ? "selected" : ""}>${e(area.name)}</option>`).join("")}</select></div><div class="field"><label for="wh-query">${e(uiText("Tabellen und Felder suchen"))}</label><input id="wh-query" value="${e(state.whQuery || "")}" type="search"></div></div>`;
}
function whHelp() {
  return `<details class="panel wh-help" ${state.dwhProject.tables.length ? "" : "open"}><summary>${e(uiText("Ich bin neu im Data Warehouse – wie fange ich an?"))}</summary><div class="panel-body"><ol><li><strong>${e(uiText("Formuliere eine Auswertung."))}</strong> ${e(uiText("Zum Beispiel: Wie hoch war der tägliche Nettoumsatz je Produkt? Lege daraus ein Teilprojekt an und benenne einen Verantwortlichen."))}</li><li><strong>${e(uiText("Bestimme, was eine Zeile bedeutet."))}</strong> ${e(uiText("Eine Verkaufsposition ist ein einzelnes Ereignis. Nettoumsatz und Menge sind Kennzahlen dieser Faktentabelle."))}</li><li><strong>${e(uiText("Ergänze den Kontext."))}</strong> ${e(uiText("Datum, Kunde und Produkt sind Dimensionen. Nutze ihre zentralen Tabellen auch in weiteren Teilprojekten."))}</li><li><strong>${e(uiText("Ordne die Herkunft zu."))}</strong> ${e(uiText("Wähle für jedes Zielfeld ein gescanntes Quellfeld oder dokumentiere eine Ableitung. Beschreibe außerdem Aktualisierung, Historie und den Umgang mit Fehlern."))}</li><li><strong>${e(uiText("Setze um und prüfe."))}</strong> ${e(uiText("Prüfe den SQL-Entwurf, lege das Modell im Zielsystem an und implementiere Ladejobs. Vergleiche danach den Zielscan mit dem Plan und prüfe Kennzahlen gegen die Quelle."))}</li></ol><p class="wh-boundary">${e(uiText("Ein Strukturvergleich bestätigt Tabellen und Felder. Ob Daten korrekt geladen wurden, dokumentierst du durch eigene Prüfungen im Bereich Betreuung."))}</p></div></details>`;
}
function whOverview() {
  const p = state.dwhProject;
  const areas = state.wh.areas;
  const shared = p.tables.filter((table) => whAreaUsage(table.id).length > 1);
  const workflow = dwhWorkflow(p, state.wh.comparison);
  const incomplete = workflow.find((step) => !step.complete);
  const next =
    !p.goal.trim() || !p.source_ids.length
      ? ["Warehouse-Ziel und Quellen festlegen", "settings"]
      : !areas.length
        ? ["Erstes Teilprojekt anlegen", "add-area"]
        : !p.tables.length
          ? [
              "Startmodell für dein Teilprojekt entwerfen",
              "starter",
              areas[0].id,
            ]
          : incomplete?.id === "overview"
            ? ["Quellscans und Warehouse-Einstellungen prüfen", "settings"]
            : incomplete?.id === "model" || incomplete?.id === "mappings"
              ? [
                  "Zielmodell und Feldzuordnungen vervollständigen",
                  "editor",
                  incomplete.id,
                ]
              : incomplete?.id === "progress"
                ? ["Warehouse im Zielsystem umsetzen", "editor", "progress"]
                : incomplete?.id === "check"
                  ? ["Umgesetzte Zielstruktur prüfen", "phase", "check"]
                  : [
                      "Datenqualität und Betrieb betreuen",
                      "phase",
                      "operations",
                    ];
  return `<section class="dwh-roadmap"><div class="dwh-roadmap-head"><div><div class="eyebrow">${e(uiText("Als Nächstes"))}</div><h2>${e(uiText(next[0]))}</h2><p>${e(uiText("Ein Warehouse enthält das gemeinsame Modell. Teilprojekte beschreiben fachliche Ziele und verwenden ausgewählte zentrale Tabellen."))}</p></div>${whButton("Jetzt bearbeiten", next[1], next[2] || "", true, !p.can_edit && ["settings", "add-area", "starter"].includes(next[1]))}</div></section>
    <div class="stats">${stat(uiText("Teilprojekte"), areas.length, "grid", uiText("Fachliche Ziele"))}${stat(uiText("Zentrale Tabellen"), p.tables.length, "table", uiText("Ein gemeinsames Zielmodell"))}${stat(uiText("Gemeinsam genutzt"), shared.length, "relations", uiText("In mehreren Teilprojekten"))}${stat(uiText("Offene Aufgaben"), state.wh.tasks.filter((task) => task.status !== "done").length, "clock", uiText("Umsetzung und Betreuung"))}</div>
    ${whHelp()}<section class="panel panel-body"><h2>${e(uiText("Dein fachliches Ziel"))}</h2><p class="dwh-prose">${e(p.goal || uiText("Noch offen"))}</p><h3>${e(uiText("Projektquellen"))}</h3><div class="tag-list">${p.source_ids.map((id) => `<button class="btn" data-action="wh-input-source" data-id="${id}">${e(state.sources.find((source) => source.id === id)?.name || uiText("Quelle #") + id)}</button>`).join("")}</div><div class="wh-card-grid wh-links">${whButton("Teilprojekte planen", "phase", "areas")}${whButton("Gesamtmodell ansehen", "phase", "model")}${whButton("Datenherkunft prüfen", "phase", "lineage")}${whButton("Umsetzung begleiten", "editor", "progress")}${whButton("Betreuung öffnen", "phase", "operations")}</div></section>
    <section class="panel panel-body"><h2>${e(uiText("Warehouse-Schichten verstehen"))}</h2><p>${e(uiText("Raw/Staging übernimmt die Quellstruktur. Core enthält gemeinsame Fakten und Dimensionen. Data Marts bereiten ausgewählte Daten für Auswertungen auf. Tabellenkopien aus einer Quelle sind zunächst Staging und brauchen eine fachliche Modellierung."))}</p></section>
    <section class="panel panel-body"><h2>${e(uiText("Änderungen im Blick"))}</h2><p>${e(uiText("{0} Hinweise zur Planung und {1} Hinweise auf geänderte Quellfelder.", p.issues.length, p.mapping_issues.length))}</p>${
      [...p.issues, ...p.mapping_issues].length
        ? `<ul class="dwh-issues">${[...p.issues, ...p.mapping_issues]
            .slice(0, 20)
            .map((issue) => `<li>${e(uiMessage(issue))}</li>`)
            .join("")}</ul>`
        : ""
    }${whButton("Feldzuordnungen bearbeiten", "editor", "mappings")}</section>`;
}
function whAreasView() {
  const p = state.dwhProject;
  return `<div class="wh-section-head"><p>${e(uiText("Eine Tabelle kann mehreren Teilprojekten zugeordnet werden. Definition, Feldzuordnung und Beziehungen bleiben zentral."))}</p>${p.can_edit ? whButton("Teilprojekt anlegen", "add-area", "", true) : ""}</div><section class="wh-card-grid">${
    state.wh.areas
      .map((area) => {
        const tables = p.tables.filter((table) =>
          area.table_ids.includes(table.id),
        );
        return `<article class="panel panel-body"><h2>${e(area.name)}</h2><p class="dwh-prose">${e(area.goal || uiText("Fachliches Ziel noch offen"))}</p><p class="small muted">${e(uiText("Verantwortlich"))}: ${e(area.owner || uiText("Noch offen"))}</p><ul class="wh-area-tables">${tables.map((table) => `<li><button class="text-button" data-action="wh-table" data-id="${table.id}">${e(table.name)}</button> <span class="badge neutral">${e(whAreaUsage(table.id).length > 1 ? uiText("Gemeinsam genutzt") : dwhRoles[table.role])}</span></li>`).join("") || `<li>${e(uiText("Noch keine Tabellen zugeordnet."))}</li>`}</ul><div class="actions">${p.can_edit ? whButton("Ziel und Tabellen bearbeiten", "edit-area", area.id) + whButton("Startmodell anlegen", "starter", area.id) + whButton("Neue Tabelle planen", "add-table", area.id) : ""}${whButton("Modell ansehen", "area-model", area.id)}</div></article>`;
      })
      .join("") ||
    `<div class="empty"><h2>${e(uiText("Dein erstes Teilprojekt"))}</h2><p>${e(uiText("Beginne mit einem Fachbereich und einer konkreten Auswertung. Du kannst weitere Bereiche später ergänzen."))}</p></div>`
  }</section>`;
}
function whModelView() {
  const tables = whVisibleTables();
  return `${whScopeControls()}<section class="panel"><div class="panel-head"><h2>${e(uiText("Globale Beziehungen"))}</h2><span class="muted small">${e(uiText("{0} zentrale Tabellen", tables.length))}</span></div><div class="dwh-diagram">${tables.length ? dwhDiagram(tables, 300) : `<div class="empty">${e(uiText("Noch keine passenden Tabellen."))}</div>`}</div><div class="panel-body small muted">${e(uiText("Das Diagramm zeigt geplante Beziehungen. Eine gefilterte Ansicht enthält nur Verbindungen zwischen sichtbaren Tabellen."))}</div></section><section class="panel"><div class="table-wrap"><table><thead><tr><th>${e(uiText("Zieltabelle"))}</th><th>${e(uiText("Rolle / Schicht"))}</th><th>${e(uiText("Teilprojekte"))}</th><th>${e(uiText("Umsetzungsstatus"))}</th><th>${e(uiText("Im Zielscan"))}</th></tr></thead><tbody>${tables
    .map((table) => {
      const actual = state.wh.comparison?.tables.find(
        (result) => result.table_id === table.id,
      );
      return `<tr><td><button class="text-button" data-action="wh-table" data-id="${table.id}">${e(table.name)}</button><p class="small muted">${e(table.grain)}</p></td><td>${e(dwhRoles[table.role])} · ${e(dwhLayers[table.layer])}</td><td>${e(
        whAreaUsage(table.id)
          .map((area) => area.name)
          .join(", ") || uiText("Zentral / noch nicht zugeordnet"),
      )}</td><td>${e(dwhStatuses[table.status])}</td><td>${e(actual ? (actual.matches ? uiText("Struktur entspricht dem Plan") : uiText("Abweichungen – Zielabgleich öffnen")) : uiText("Noch nicht geprüft"))}</td></tr>`;
    })
    .join("")}</tbody></table></div></section>`;
}
function whLineageView() {
  const query = (state.whQuery || "").trim().toLowerCase();
  const rows = whVisibleTables().flatMap((table) =>
    table.columns
      .filter(
        (column) =>
          !query ||
          [table.name, table.description, column.name]
            .join(" ")
            .toLowerCase()
            .includes(query),
      )
      .map((column) => ({ table, column })),
  );
  const limit = state.whLineageLimit || 100;
  return `${whScopeControls()}<section class="panel"><div class="panel-head"><div><h2>${e(uiText("Von der Quelle zum zentralen Zielfeld"))}</h2><p class="small muted">${e(uiText("Gespeicherte Feldzuordnungen beschreiben die Planung; sie bestätigen keine ausgeführten Ladejobs."))}</p></div></div><div class="table-wrap"><table><thead><tr><th>${e(uiText("Zielfeld"))}</th><th>${e(uiText("Teilprojekte"))}</th><th>${e(uiText("Quelle / Scan"))}</th><th>${e(uiText("Ableitungsregel"))}</th></tr></thead><tbody>${rows
    .slice(0, limit)
    .map(
      ({ table, column }) =>
        `<tr><td>${state.dwhProject.can_edit ? `<button class="text-button" data-action="wh-column" data-id="${column.id}" data-table-id="${table.id}">${e(table.name)}.${e(column.name)}</button>` : `${e(table.name)}.${e(column.name)}`}</td><td>${e(
          whAreaUsage(table.id)
            .map((area) => area.name)
            .join(", ") || "—",
        )}</td><td>${column.mapping ? `${e(state.sources.find((source) => source.id === column.mapping.source_id)?.name || uiText("Quelle #") + column.mapping.source_id)}<p class="small mono">${e(column.mapping.table_key)}.${e(column.mapping.column_name)} · #${column.mapping.snapshot_id}</p>` : e(column.identity ? uiText("Automatischer Schlüssel") : uiText("Noch keine Quellzuordnung"))}</td><td class="dwh-prose">${e(column.transformation || "—")}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table></div><div class="catalog-pagination"><span>${e(uiText("Zeige {0} von {1} Feldern", Math.min(limit, rows.length), rows.length))}</span>${rows.length > limit ? whButton("Weitere Felder anzeigen", "more-fields") : ""}</div></section>`;
}
function whCheckView() {
  const comparison = state.wh.comparison;
  return `<section class="panel panel-body"><h2>${e(uiText("Zielstruktur mit dem gemeinsamen Plan vergleichen"))}</h2><p>${e(uiText("Verbinde die Zieldatenquelle in den Warehouse-Einstellungen und scanne sie nach der Umsetzung. Diese Ansicht nutzt den letzten gespeicherten Scan und zeigt keine live geladenen Datenwerte."))}</p><div class="actions">${whButton("Zieldatenquelle öffnen", "target", "", false, !state.dwhProject.target_source_id)}${whButton("Gescanntes ER-Modell öffnen", "target-er", "", false, !comparison)}${state.dwhProject.can_edit ? whButton("Warehouse-Einstellungen", "settings") : ""}${whButton("Neu laden", "reload")}</div></section>${comparison ? `<section class="panel panel-body"><p>${e(uiText("{0} von {1} Tabellen entsprechen dem Plan.", comparison.matched, comparison.total))}</p><p class="small muted">${e(uiText("Zielscan"))} #${comparison.snapshot_id} · ${e(dt(comparison.created))}</p><ul class="dwh-issues">${comparison.tables.flatMap((table) => [...table.issues.map((issue) => `<li><strong>${e(table.table_name)}</strong>: ${e(uiMessage(issue))}</li>`), ...(table.extra_columns.length ? [`<li><strong>${e(table.table_name)}</strong>: ${e(uiText("Weitere Zielfelder: {0}", table.extra_columns.join(", ")))}</li>`] : [])]).join("")}</ul><h3>${e(uiText("Weitere Tabellen im Ziel"))}</h3><p class="dwh-prose">${e(comparison.extra_tables.join(", ") || "—")}</p><p class="wh-boundary">${e(uiText("Datenqualität und fachliche Richtigkeit prüfst du separat. Halte Prüfergebnisse im Bereich Betreuung fest."))}</p></section>` : `<div class="empty">${e(uiText("Für den Zielabgleich fehlt eine passende Zieldatenquelle mit erfolgreichem Scan."))}</div>`}`;
}
function whOperationsView() {
  const localDate = new Date();
  const today = [
    localDate.getFullYear(),
    String(localDate.getMonth() + 1).padStart(2, "0"),
    String(localDate.getDate()).padStart(2, "0"),
  ].join("-");
  return `<section class="panel panel-body"><h2>${e(uiText("Umsetzung, Datenqualität und laufenden Betrieb begleiten"))}</h2><p>${e(uiText("Weise Aufgaben einer Person zu, setze Prüftermine und dokumentiere Ergebnisse. Bei erledigten Aufgaben ist ein Ergebnis erforderlich. Alle Statusangaben werden von eurem Team gepflegt."))}</p>${state.dwhProject.can_edit ? whButton("Aufgabe anlegen", "add-task", "", true) : ""}</section><section class="panel"><div class="table-wrap"><table><thead><tr><th>${e(uiText("Aufgabe"))}</th><th>${e(uiText("Teilprojekt / Verantwortlich"))}</th><th>${e(uiText("Termin"))}</th><th>${e(uiText("Status"))}</th><th>${e(uiText("Ergebnis / Notizen"))}</th><th></th></tr></thead><tbody>${state.wh.tasks.map((task) => `<tr><td><strong>${e(task.title)}</strong><p class="small muted">${e(whTaskKinds[task.kind])}</p></td><td>${e(state.wh.areas.find((area) => area.id === task.area_id)?.name || uiText("Gesamtes Warehouse"))}<p class="small muted">${e(task.owner || uiText("Noch offen"))}</p></td><td>${e(task.due_date ? new Date(task.due_date + "T12:00:00").toLocaleDateString(uiLocale) : "—")}${task.status !== "done" && task.due_date && task.due_date < today ? `<span class="badge error">${e(uiText("Überfällig"))}</span>` : ""}</td><td>${e(whTaskStatuses[task.status])}</td><td class="dwh-prose">${e(task.notes || "—")}</td><td>${state.dwhProject.can_edit ? whButton("Bearbeiten", "edit-task", task.id) : ""}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function renderWarehouseWorkspace() {
  const p = state.dwhProject;
  const views = {
    overview: whOverview,
    areas: whAreasView,
    model: whModelView,
    lineage: whLineageView,
    check: whCheckView,
    operations: whOperationsView,
  };
  shell(
    `<button class="back" data-action="nav" data-view="warehouse">${icon("back")} ${e(uiText("Alle DWH-Projekte"))}</button><div class="page-head"><div><div class="eyebrow">${e(uiText("Zentrales Warehouse"))} · ${e(dwhEngines[p.target_kind])} · ${e(p.target_schema)}</div><h1>${e(p.name)}</h1><p>${e(uiText("Ein gemeinsames Modell für alle Teilprojekte"))} · ${e(uiText("Version"))} ${p.version}</p></div><div class="actions">${whButton("Neu laden", "reload")}${whButton("Dokumentation herunterladen", "export")}${whButton("SQL-Entwurf", "sql")}${p.can_edit ? whButton("Warehouse-Einstellungen", "settings") + whButton("Projekt übernehmen", "adopt") : ""}</div></div>${tabs(whTabs, state.whTab || "overview", "wh-tab")}<div id="wh-view">${(views[state.whTab] || whOverview)()}</div>`,
  );
}
function whAreaModal(id = "") {
  const area = state.wh.areas.find((area) => area.id === id) || {
    id: dwhUUID(),
    name: "",
    goal: "",
    owner: "",
    table_ids: [],
  };
  openModal(
    uiText(id ? "Teilprojekt bearbeiten" : "Teilprojekt anlegen"),
    `<form id="wh-area-form" data-id="${area.id}">${field(uiText("Name des Teilprojekts"), "name", area.name, "text", 'required maxlength="190"')}${dwhArea(uiText("Welche Auswertung brauchst du?"), "goal", area.goal, uiText("Zum Beispiel: täglicher Nettoumsatz je Produkt; Aktualisierung jeden Morgen; zwei Jahre Historie."), 10000)}${field(uiText("Verantwortlich"), "owner", area.owner, "text", 'maxlength="190"')}<div class="field"><label for="wh-area-tables">${e(uiText("Zentrale Tabellen verwenden"))}</label><select id="wh-area-tables" name="table_ids" multiple size="8">${state.dwhProject.tables.map((table) => `<option value="${table.id}" ${area.table_ids.includes(table.id) ? "selected" : ""}>${e(table.name)} · ${e(dwhRoles[table.role])}</option>`).join("")}</select><small>${e(uiText("Wähle vorhandene Tabellen aus. Sie werden gemeinsam genutzt; alle Teilprojekte sehen dieselbe Definition."))}</small></div>${id ? whButton("Teilprojekt entfernen", "remove-area", id) : ""}${dwhFooter()}</form>`,
  );
}
function whTaskModal(id = "") {
  const task = state.wh.tasks.find((task) => task.id === id) || {
    id: dwhUUID(),
    title: "",
    kind: "operations",
    area_id: null,
    owner: "",
    due_date: null,
    status: "open",
    notes: "",
  };
  openModal(
    uiText(id ? "Aufgabe bearbeiten" : "Aufgabe anlegen"),
    `<form id="wh-task-form" data-id="${task.id}">${field(uiText("Aufgabe"), "title", task.title, "text", 'required maxlength="190"')}<div class="form-grid">${dwhSelect(uiText("Aufgabenart"), "kind", whTaskKinds, task.kind)}${dwhSelect(uiText("Status"), "status", whTaskStatuses, task.status)}</div>${dwhSelect(uiText("Teilprojekt"), "area_id", { "": uiText("Gesamtes Warehouse"), ...Object.fromEntries(state.wh.areas.map((area) => [area.id, area.name])) }, task.area_id || "")}<div class="form-grid">${field(uiText("Verantwortlich"), "owner", task.owner, "text", 'maxlength="190"')}${field(uiText("Nächster Prüftermin"), "due_date", task.due_date || "", "date")}</div>${dwhArea(uiText("Ergebnis / Notizen"), "notes", task.notes, uiText("Was wurde wann geprüft? Ergebnis, Abweichungen und weitere Maßnahmen festhalten."))}${id ? whButton("Aufgabe entfernen", "remove-task", id) : ""}${dwhFooter()}</form>`,
  );
}
function whStarterModal(areaId) {
  const area = state.wh.areas.find((area) => area.id === areaId);
  if (!area) return;
  openModal(
    uiText("Startmodell für dein Teilprojekt"),
    `<form id="wh-starter-form" data-id="${area.id}"><p>${e(uiText("Der Assistent plant eine Faktentabelle mit einer Kennzahl und eine gemeinsame Kalenderdimension dim_date. Eine vorhandene dim_date wird wiederverwendet. Quellzuordnungen und Ladejobs legst du anschließend fest."))}</p>${field(
      uiText("Name der Faktentabelle"),
      "fact_name",
      "fact_" +
        area.name
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "_")
          .slice(0, 45),
      "text",
      'required maxlength="63" pattern="[A-Za-z_][A-Za-z0-9_]*"',
    )}${field(uiText("Was beschreibt eine Zeile?"), "grain", "", "text", 'required maxlength="2000"')}${field(uiText("Technischer Name der Kennzahl"), "measure_name", "amount", "text", 'required maxlength="63" pattern="[A-Za-z_][A-Za-z0-9_]*"')}${field(uiText("Bedeutung und Einheit der Kennzahl"), "measure_description", "", "text", 'required maxlength="2000"')}<p class="wh-boundary">${e(uiText("Dies ist ein Startentwurf. Prüfe Datentypen, Genauigkeit, Zeilenbedeutung und Kalenderdimension vor der Umsetzung."))}</p>${dwhFooter(uiText("Startmodell anlegen"))}</form>`,
  );
}
async function whAdoptModal() {
  const projects = (await api("/api/dwh/projects")).filter(
    (project) =>
      !project.warehouse_id &&
      project.can_edit &&
      project.target_kind === state.dwhProject.target_kind,
  );
  state.whAdoptProjects = projects;
  openModal(
    uiText("Projekt in das Warehouse übernehmen"),
    `<form id="wh-adopt-form"><p>${e(uiText("Die Planung wird als Teilprojekt ins zentrale Modell übernommen. Das ursprüngliche Projekt bleibt erhalten und wird danach unabhängig gepflegt. Das zentrale Zielschema gilt für alle übernommenen Tabellen."))}</p>${dwhSelect(uiText("Projekt"), "project_id", { "": uiText("Bitte auswählen"), ...Object.fromEntries(projects.map((project) => [project.id, project.name])) }, "")}${field(uiText("Name des Teilprojekts"), "area_name", "", "text", 'required maxlength="190"')}<div id="wh-reuse-fields"></div><p class="small muted">${e(uiText("Gemeinsame Tabellen nur auswählen, wenn die fachliche Bedeutung übereinstimmt. Ihre zentrale Definition und Quellzuordnung bleiben erhalten."))}</p>${dwhFooter(uiText("Planung übernehmen"))}</form>`,
  );
}
async function whAdoptSelection() {
  const input = document.getElementById("dwh-project_id");
  const id = Number(input.value);
  document.getElementById("wh-reuse-fields").replaceChildren();
  state.whIncomingProject = null;
  if (!id) return;
  const project = await api(`/api/dwh/projects/${id}`);
  if (!input.isConnected || Number(input.value) !== id) return;
  state.whIncomingProject = project;
  document.getElementById("f-area_name").value = project.name;
  document.getElementById("wh-reuse-fields").innerHTML = project.tables
    .map(
      (table) =>
        `<div class="field"><label for="wh-reuse-${table.id}">${e(table.name)}</label><select id="wh-reuse-${table.id}" name="reuse-${table.id}"><option value="">${e(uiText("Als neue zentrale Tabelle übernehmen"))}</option>${state.dwhProject.tables.map((target) => `<option value="${target.id}">${e(uiText("Gemeinsam verwenden: {0}", target.name))}</option>`).join("")}</select></div>`,
    )
    .join("");
}
async function whSaveMetadata(areas = state.wh.areas, tasks = state.wh.tasks) {
  const result = await api(`/api/dwh/warehouses/${state.wh.id}`, "PUT", {
    version: state.dwhProject.version,
    areas,
    tasks,
  });
  whSet(result);
  modal.close();
  renderWarehouseWorkspace();
}
async function warehouseWorkspaceClick(button) {
  const action = button.dataset.action.slice(3),
    id = button.dataset.id;
  if (action === "create") {
    dwhProjectModal();
    document.getElementById("dwh-project-form").dataset.workspace = "true";
    document.querySelector("#modal h2").textContent = uiText(
      "Zentrales Warehouse anlegen",
    );
    document.querySelector('#dwh-project-form [type="submit"]').textContent =
      uiText("Warehouse starten");
  }
  if (action === "open") await navigate("warehouse-workspace", id);
  if (action === "convert") {
    const project = state.dwhProjects.find(
      (project) => project.id === Number(id),
    );
    if (
      !confirm(
        uiText(
          "Dieses Projekt als gemeinsames Warehouse-Modell verwenden? Die bestehenden Tabellen bleiben erhalten.",
        ),
      )
    )
      return;
    const result = await api("/api/dwh/warehouses/from-project", "POST", {
      project_id: project.id,
      version: project.version,
    });
    await navigate("warehouse-workspace", result.id);
  }
  if (action === "phase" || action === "tab") {
    state.whTab = action === "tab" ? button.dataset.tab : id;
    history.replaceState(
      null,
      "",
      `#warehouse-workspace/${state.wh.id}?phase=${state.whTab}`,
    );
    renderWarehouseWorkspace();
  }
  if (action === "reload") await whRefresh();
  if (action === "settings") dwhProjectModal(true);
  if (action === "editor")
    await navigate("warehouse-project", state.dwhProject.id, {
      step: id || "model",
    });
  if (action === "table")
    await navigate("warehouse-project", state.dwhProject.id, {
      step: "model",
      table: id,
    });
  if (action === "column") {
    state.dwhTableId = button.dataset.tableId;
    await dwhColumnModal(id);
  }
  if (action === "area-model") {
    state.whAreaFilter = id;
    state.whTab = "model";
    history.replaceState(
      null,
      "",
      `#warehouse-workspace/${state.wh.id}?phase=model`,
    );
    renderWarehouseWorkspace();
  }
  if (action === "add-area" || action === "edit-area") whAreaModal(id);
  if (action === "add-task" || action === "edit-task") whTaskModal(id);
  if (action === "starter") whStarterModal(id);
  if (action === "add-table") {
    dwhTableModal();
    document.getElementById("dwh-table-form").dataset.areaId = id;
  }
  if (action === "adopt") await whAdoptModal();
  if (
    action === "remove" &&
    confirm(
      uiText(
        "Warehouse-Verwaltung entfernen? Teilprojekte und Betreuungsaufgaben werden gelöscht. Das Zielmodell bleibt als eigenständiges Projekt erhalten.",
      ),
    )
  ) {
    await api(
      `/api/dwh/warehouses/${id}?version=${state.dwhProject.version}`,
      "DELETE",
    );
    modal.close();
    state.whReturn = null;
    await navigate("warehouse");
    toast(
      uiText("Warehouse-Verwaltung entfernt. Das Zielmodell bleibt erhalten."),
    );
  }
  if (
    action === "remove-area" &&
    confirm(
      uiText("Teilprojekt entfernen? Die zentralen Tabellen bleiben erhalten."),
    )
  )
    await whSaveMetadata(
      state.wh.areas.filter((area) => area.id !== id),
      state.wh.tasks.map((task) =>
        task.area_id === id ? { ...task, area_id: null } : task,
      ),
    );
  if (action === "remove-task" && confirm(uiText("Aufgabe entfernen?")))
    await whSaveMetadata(
      state.wh.areas,
      state.wh.tasks.filter((task) => task.id !== id),
    );
  if (
    action === "target" ||
    action === "target-er" ||
    action === "input-source"
  ) {
    state.whReturn = {
      id: state.wh.id,
      name: state.dwhProject.name,
      phase: state.whTab,
    };
    await navigate(
      "source",
      action.startsWith("target") ? state.dwhProject.target_source_id : id,
      action === "target-er" ? { tab: "er" } : {},
    );
  }
  if (action === "return") {
    const phase =
      state.whReturn?.id === Number(id) ? state.whReturn.phase : "overview";
    state.whReturn = null;
    await navigate("warehouse-workspace", id, { phase });
  }
  if (action === "more-fields") {
    state.whLineageLimit = (state.whLineageLimit || 100) + 100;
    renderWarehouseWorkspace();
  }
  if (action === "sql") await dwhDownload("sql");
  if (action === "export") {
    const response = await fetch(`/api/dwh/warehouses/${state.wh.id}/export`, {
      credentials: "same-origin",
    });
    if (!response.ok)
      throw new Error(uiText("Dokumentation konnte nicht exportiert werden."));
    const url = URL.createObjectURL(await response.blob()),
      link = document.createElement("a");
    link.href = url;
    link.download = `databasedoc-warehouse-${state.wh.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
async function warehouseWorkspaceSubmit(form) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const fd = new FormData(form),
    data = Object.fromEntries(fd),
    id = form.dataset.id;
  try {
    if (form.id === "wh-area-form") {
      const area = {
        id,
        name: data.name,
        goal: data.goal,
        owner: data.owner,
        table_ids: fd.getAll("table_ids"),
      };
      await whSaveMetadata([
        ...state.wh.areas.filter((area) => area.id !== id),
        area,
      ]);
    }
    if (form.id === "wh-task-form") {
      const task = {
        ...data,
        id,
        area_id: data.area_id || null,
        due_date: data.due_date || null,
      };
      await whSaveMetadata(state.wh.areas, [
        ...state.wh.tasks.filter((task) => task.id !== id),
        task,
      ]);
    }
    if (form.id === "wh-starter-form") {
      whSet(
        await api(`/api/dwh/warehouses/${state.wh.id}/starter`, "POST", {
          ...data,
          area_id: id,
          version: state.dwhProject.version,
        }),
      );
      modal.close();
      renderWarehouseWorkspace();
    }
    if (form.id === "wh-adopt-form") {
      if (
        !state.whIncomingProject ||
        state.whIncomingProject.id !== Number(data.project_id)
      )
        throw new Error(uiText("Bitte zuerst ein Projekt auswählen."));
      const reuse = Object.fromEntries(
        [...fd.entries()]
          .filter(([key, value]) => key.startsWith("reuse-") && value)
          .map(([key, value]) => [key.slice(6), value]),
      );
      whSet(
        await api(`/api/dwh/warehouses/${state.wh.id}/adopt-project`, "POST", {
          project_id: Number(data.project_id),
          source_version: state.whIncomingProject.version,
          area_name: data.area_name,
          reuse,
          version: state.dwhProject.version,
        }),
      );
      modal.close();
      renderWarehouseWorkspace();
    }
    toast(uiText("Warehouse gespeichert."));
  } catch (error) {
    const node = document.getElementById("form-error");
    if (node) node.textContent = error.message;
    else toast(error.message);
  } finally {
    button.disabled = false;
  }
}
function warehouseWorkspaceChange(input) {
  if (input.id === "wh-filter") {
    state.whAreaFilter = input.value;
    renderWarehouseWorkspace();
  }
  if (input.id === "dwh-project_id")
    whAdoptSelection().catch((error) => {
      document.getElementById("form-error").textContent = error.message;
    });
}
function warehouseWorkspaceSearch(input) {
  if (input.id !== "wh-query") return;
  state.whQuery = input.value;
  state.whLineageLimit = 100;
  const cursor = input.selectionStart;
  const container = document.getElementById("wh-view");
  container.innerHTML =
    state.whTab === "lineage" ? whLineageView() : whModelView();
  const replacement = document.getElementById("wh-query");
  replacement.focus();
  try {
    replacement.setSelectionRange(cursor, cursor);
  } catch {}
}
