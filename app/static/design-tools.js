"use strict";
const toolTabs = [
  ["model", uiText("Datenbankmodell"), "table"],
  ["sql", uiText("SQL-Skripte"), "download"],
  ["sharing", uiText("Sichtbarkeit & Freigaben"), "users"],
];
function toolButton(label, action, id = "", primary = false) {
  return `<button type="button" class="btn ${primary ? "primary" : ""}" data-action="tool-${action}" data-id="${e(id)}">${e(uiText(label))}</button>`;
}
function toolBody() {
  const p = state.toolDesign;
  return Object.fromEntries(
    [
      "name",
      "description",
      "target_kind",
      "database_name",
      "target_schema",
      "tables",
      "version",
    ].map((k) => [k, structuredClone(p[k])]),
  );
}
function toolTable() {
  return (
    state.toolDesign.tables.find((t) => t.id === state.toolTableId) ||
    state.toolDesign.tables[0]
  );
}
function toolContext(columnId = null) {
  state.toolEditContext = {
    id: state.toolDesign.id,
    version: state.toolDesign.version,
    tableId: toolTable()?.id,
    columnId,
  };
}
async function toolSave(body) {
  const p = state.toolDesign;
  const result = await api(`/api/tools/designs/${p.id}`, "PUT", body);
  state.toolDesign = result;
  state.toolSql = null;
  renderToolDesign();
  toast(uiText("Entwurf gespeichert."));
}
function renderTools() {
  shell(
    `<div class="page-head"><div><div class="eyebrow">Tools</div><h1>${e(uiText("Datenbankdesigner"))}</h1><p>${e(uiText("Plane Datenbanken, Tabellen und Beziehungen und exportiere passende SQL-Skripte."))}</p></div>${toolButton("Neuer Datenbankentwurf", "new", "", true)}</div><section class="panel panel-body tool-intro"><h2>${e(uiText("Vom Entwurf zur Datenbank"))}</h2><p>${e(uiText("1. Datenbank und Plattform festlegen · 2. Tabellen und Beziehungen gestalten · 3. SQL prüfen und herunterladen · 4. Auf dem Zielserver ausführen"))}</p><p class="muted">${e(uiText("Neue Entwürfe sind privat. Du entscheidest, mit wem du sie teilst. Die Ausführung der SQL-Skripte erfolgt außerhalb von DatabaseDoc."))}</p></section><div class="tool-filters"><input id="tool-search" type="search" placeholder="${e(uiText("Entwürfe durchsuchen …"))}" aria-label="${e(uiText("Entwürfe durchsuchen"))}"><select id="tool-scope" aria-label="${e(uiText("Entwürfe filtern"))}"><option value="all">${e(uiText("Alle sichtbaren Entwürfe"))}</option><option value="own">${e(uiText("Meine Entwürfe"))}</option><option value="shared">${e(uiText("Mit mir geteilt"))}</option></select></div><div class="tool-design-list">${state.toolDesigns.map((p) => `<article class="panel panel-body tool-design-card" data-tool-id="${p.id}"><div class="actions"><span class="badge ${p.shared ? "" : "neutral"}">${e(uiText(p.is_owner ? (p.shared ? "Geteilt" : "Privat") : "Mit mir geteilt"))}</span><span class="small muted">${e(dwhEngines[p.target_kind])}</span></div><h2><button class="source-title" data-action="tool-open" data-id="${p.id}">${e(p.name)}</button></h2><p class="mono">${e(p.database_name)} · ${p.table_count} ${e(uiText("Tabellen"))}</p><p class="small muted">${e(p.owner_name)} · ${e(uiText(p.can_edit ? "Bearbeiten" : "Lesen"))}</p></article>`).join("")}</div><p id="tool-no-results" class="muted" ${state.toolDesigns.length ? "hidden" : ""}>${e(uiText("Keine sichtbaren Entwürfe. Lege deinen ersten privaten Datenbankentwurf an."))}</p>`,
  );
}
function toolsFilter() {
  const query =
      document
        .getElementById("tool-search")
        ?.value.trim()
        .toLocaleLowerCase(uiLocale) || "",
    scope = document.getElementById("tool-scope")?.value || "all";
  let count = 0;
  for (const card of document.querySelectorAll("[data-tool-id]")) {
    const p = state.toolDesigns.find(
      (x) => x.id === Number(card.dataset.toolId),
    );
    card.hidden =
      !(scope === "all" || (scope === "own" ? p.is_owner : !p.is_owner)) ||
      ![p.name, p.database_name, p.owner_name]
        .join(" ")
        .toLocaleLowerCase(uiLocale)
        .includes(query);
    if (!card.hidden) count++;
  }
  document.getElementById("tool-no-results").hidden = Boolean(count);
}
function toolDesignModal(edit = false) {
  const p = edit
    ? state.toolDesign
    : {
        name: "",
        description: "",
        target_kind: "postgresql",
        database_name: "",
        target_schema: "public",
      };
  if (edit) toolContext();
  openModal(
    uiText(edit ? "Entwurf bearbeiten" : "Neuer Datenbankentwurf"),
    `<form id="tool-design-form" data-edit="${edit}">${field(uiText("Entwurfsname"), "name", p.name, "text", 'required maxlength="190"')}${dwhArea(uiText("Beschreibung"), "description", p.description, "", 10000)}${dwhSelect(uiText("Zielplattform"), "target_kind", dwhEngines, p.target_kind)}${field(uiText("Datenbankname"), "database_name", p.database_name, "text", 'required maxlength="63" pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="application_db"')}${field(uiText("Schema"), "target_schema", p.target_schema, "text", 'required maxlength="63" pattern="[A-Za-z_][A-Za-z0-9_]*"')}<p class="small muted">${e(uiText("Namen verwenden Buchstaben, Ziffern und Unterstriche. Bei MariaDB entspricht das Schema dem Datenbanknamen."))}</p>${!edit ? `<p>${e(uiText("Dieser Entwurf ist zunächst nur für dich sichtbar."))}</p>` : ""}${dwhFooter()}</form>`,
  );
  toolsChange(document.querySelector('#tool-design-form [name="target_kind"]'));
}
function renderToolDesign() {
  const p = state.toolDesign;
  state.toolTab ||= "model";
  if (
    !state.toolSharing ||
    state.toolSharing.id !== p.id ||
    state.toolSharing.version !== p.version
  )
    state.toolSharing = {
      id: p.id,
      version: p.version,
      grants: structuredClone(p.grants || []),
      users: [],
      query: "",
    };
  shell(
    `<button class="back" data-action="nav" data-view="tools">${icon("back")} ${e(uiText("Alle Datenbankentwürfe"))}</button><div class="page-head"><div><div class="eyebrow">Tools · ${e(dwhEngines[p.target_kind])} · ${e(p.database_name)}</div><h1>${e(p.name)}</h1><p>${e(uiText("Entwurfsversion {0}", p.version))} · ${e(p.owner_name)} · ${e(uiText(p.shared ? "Geteilt" : "Privat"))}</p></div><div class="actions">${toolButton("Neu laden", "reload")}${p.can_edit ? toolButton("Entwurf bearbeiten", "settings") : ""}${toolButton("JSON", "json")}</div></div><div class="hint"><span>${e(uiText("Hier bearbeitest du einen Plan. Erst das manuelle Ausführen eines SQL-Skripts verändert eine echte Datenbank."))}</span></div>${tabs(
      toolTabs.filter(([id]) => id !== "sharing" || p.is_owner),
      state.toolTab,
      "tool-tab",
    )}${state.toolTab === "sql" ? toolSqlView() : state.toolTab === "sharing" ? toolSharingView() : toolModelView()}`,
  );
}
function toolModelView() {
  const p = state.toolDesign,
    t = toolTable();
  return `${p.description ? `<p class="dwh-prose">${e(p.description)}</p>` : ""}<div class="dwh-model-actions">${p.can_edit ? toolButton("Tabelle anlegen", "add-table", "", true) : `<span>${e(uiText("Dieser Entwurf ist für dich schreibgeschützt."))}</span>`}</div>${p.tables.length ? `<section class="panel dwh-diagram-panel"><div class="panel-head"><h2>${e(uiText("ER-Diagramm"))}</h2></div><div class="dwh-diagram">${dwhDiagram(p.tables, 300, { tables: p.tables, selectedId: t.id, action: "tool-table", caption: (x) => uiText("{0} Spalten", x.columns.length), label: uiText("Geplantes Datenbankmodell") })}</div></section><div class="schema-layout"><aside class="object-list"><div class="object-items">${p.tables.map((x) => `<button class="object-item ${x.id === t.id ? "active" : ""}" data-action="tool-table" data-id="${x.id}">${icon("table")}<span>${e(x.name)}</span></button>`).join("")}</div></aside><section class="panel object-detail"><div class="panel-head"><h2>${e(t.name)}</h2>${p.can_edit ? toolButton("Tabelle bearbeiten", "edit-table") : ""}</div><div class="panel-body"><p class="dwh-prose">${e(t.description)}</p></div><div class="panel-head"><h3>${e(uiText("Spalten"))}</h3>${p.can_edit ? toolButton("Spalte hinzufügen", "add-column") : ""}</div><div class="table-wrap"><table><thead><tr><th>${e(uiText("Spaltenname"))}</th><th>${e(uiText("Datentyp"))}</th><th>NULL</th><th></th></tr></thead><tbody>${t.columns.map((c) => `<tr><td class="mono">${c.primary_key ? '<span class="key-label">PK</span>' : ""}${e(c.name)}${c.identity ? `<div class="small muted">${e(uiText("Automatischer Schlüssel"))}</div>` : ""}</td><td class="mono">${e(dwhTypeLabel(c))}</td><td>${e(uiText(c.nullable ? "Ja" : "Nein"))}</td><td>${p.can_edit ? toolButton("Bearbeiten", "edit-column", c.id) : ""}</td></tr>`).join("") || `<tr><td colspan="4">${e(uiText("Noch keine Spalten geplant."))}</td></tr>`}</tbody></table></div><div class="panel-head"><h3>${e(uiText("Beziehungen"))}</h3>${p.can_edit ? toolButton("Beziehung anlegen", "add-relation") : ""}</div><div class="panel-body">${t.relations.map((r) => `<div class="dwh-relation"><span class="mono">${e(r.columns.join(", "))} → ${e(p.tables.find((x) => x.id === r.target_table_id)?.name)} (${e(r.target_columns.join(", "))})</span>${p.can_edit ? toolButton("Entfernen", "remove-relation", r.id) : ""}</div>`).join("") || `<p class="muted">${e(uiText("Noch keine Beziehungen geplant."))}</p>`}</div>${p.can_edit ? `<div class="panel-body"><button class="text-button danger" data-action="tool-remove-table">${e(uiText("Tabelle aus dem Entwurf entfernen"))}</button></div>` : ""}</section></div>` : `<section class="panel empty"><h2>${e(uiText("Gestalte deine Datenbank"))}</h2><p>${e(uiText("Lege zuerst Tabellen an, ergänze Spalten und Primärschlüssel und verbinde die Tabellen über Beziehungen."))}</p></section>`}`;
}
function toolTableModal(edit = false) {
  const t = edit ? toolTable() : { name: "", description: "" };
  toolContext();
  openModal(
    uiText(edit ? "Tabelle bearbeiten" : "Tabelle anlegen"),
    `<form id="tool-table-form" data-edit="${edit}">${field(uiText("Tabellenname"), "name", t.name, "text", 'required maxlength="63" pattern="[A-Za-z_][A-Za-z0-9_]*"')}${dwhArea(uiText("Beschreibung"), "description", t.description)}${dwhFooter()}</form>`,
  );
}
function toolColumnModal(id = null) {
  const c = toolTable().columns.find((x) => x.id === id) || {
    name: "",
    data_type: "varchar",
    length: 255,
    precision: 18,
    scale: 2,
    nullable: true,
    primary_key: false,
    identity: false,
    description: "",
  };
  toolContext(id);
  openModal(
    uiText(id ? "Spalte bearbeiten" : "Spalte hinzufügen"),
    `<form id="tool-column-form">${field(uiText("Spaltenname"), "name", c.name, "text", 'required maxlength="63" pattern="[A-Za-z_][A-Za-z0-9_]*"')}${dwhSelect(uiText("Datentyp"), "data_type", dwhTypes, c.data_type)}<div class="form-grid">${field(uiText("Textlänge"), "length", c.length, "number", 'required min="1" max="4000"')}${field(uiText("Dezimalpräzision"), "precision", c.precision, "number", 'required min="1" max="38"')}${field(uiText("Dezimalstellen"), "scale", c.scale, "number", 'required min="0" max="38"')}</div><div class="dwh-checks"><label><input type="checkbox" name="nullable" ${c.nullable ? "checked" : ""}> ${e(uiText("NULL erlaubt"))}</label><label><input type="checkbox" name="primary_key" ${c.primary_key ? "checked" : ""}> ${e(uiText("Primärschlüssel"))}</label><label><input type="checkbox" name="identity" ${c.identity ? "checked" : ""}> ${e(uiText("Automatischer Schlüssel"))}</label></div>${dwhArea(uiText("Beschreibung"), "description", c.description, "", 2000)}${id ? `<button type="button" class="text-button danger" data-action="tool-remove-column">${e(uiText("Spalte aus dem Entwurf entfernen"))}</button>` : ""}${dwhFooter()}</form>`,
  );
  toolsChange(document.querySelector('#tool-column-form [name="data_type"]'));
}
function toolRelationModal() {
  toolContext();
  const targets = state.toolDesign.tables.filter((t) =>
    t.columns.some((c) => c.primary_key),
  );
  if (!targets.length)
    throw Error(uiText("Die Zieltabelle benötigt einen Primärschlüssel."));
  openModal(
    uiText("Beziehung anlegen"),
    `<form id="tool-relation-form">${field(uiText("Spalten dieser Tabelle"), "columns", "", "text", 'required placeholder="customer_id"')}${dwhSelect(uiText("Referenzierte Tabelle"), "target_table_id", Object.fromEntries(targets.map((t) => [t.id, t.name])), targets[0].id)}<p class="small muted" id="tool-relation-key"></p><p class="small muted">${e(uiText("Spalten durch Kommas trennen. Reihenfolge und Datentypen müssen dem vollständigen Ziel-Primärschlüssel entsprechen."))}</p>${dwhFooter()}</form>`,
  );
  toolsChange(
    document.querySelector('#tool-relation-form [name="target_table_id"]'),
  );
}
function toolSqlView() {
  const p = state.toolDesign;
  return `<section class="panel panel-body tool-sql"><h2>${e(uiText("SQL-Skripte für {0}", dwhEngines[p.target_kind]))}</h2><p>${e(uiText("Führe die Schritte einzeln aus: zuerst die Datenbank anlegen, danach mit dieser Datenbank verbinden und das Tabellenskript ausführen. PostgreSQL benötigt für CREATE/DROP DATABASE eine Ausführung außerhalb einer Transaktion."))}</p><div class="tool-sql-modes"><label>${e(uiText("SQL-Skript"))}<select id="tool-sql-mode">${Object.entries(
    {
      database: uiText("1. Datenbank anlegen"),
      schema: uiText("2. Tabellen & Beziehungen anlegen"),
      drop: uiText("Datenbank entfernen (DROP DATABASE)"),
    },
  )
    .map(
      ([k, v]) =>
        `<option value="${k}" ${k === (state.toolSqlMode || "schema") ? "selected" : ""}>${e(v)}</option>`,
    )
    .join(
      "",
    )}</select></label>${toolButton("SQL-Vorschau", "sql-preview", "", true)}${toolButton("SQL herunterladen", "sql-download")}</div><p id="tool-drop-warning" class="error-text" ${state.toolSqlMode === "drop" ? "" : "hidden"}>${e(uiText("DROP DATABASE löscht die gesamte Datenbank einschließlich aller Daten. Dieses Skript ist kein Entwurf-Löschen."))}</p><pre class="tool-sql-preview" tabindex="0">${e(state.toolSql || uiText("Wähle ein Skript und öffne die Vorschau. Der Export verwendet den gespeicherten Entwurf."))}</pre></section>${p.is_owner ? `<section class="panel panel-body"><h3>${e(uiText("Entwurf löschen"))}</h3><p>${e(uiText("Entfernt nur diesen gespeicherten Plan und seine Freigaben aus DatabaseDoc."))}</p><button type="button" class="btn danger" data-action="tool-delete">${e(uiText("Entwurf löschen"))}</button></section>` : ""}`;
}
function toolSharingView() {
  const p = state.toolDesign,
    s = state.toolSharing;
  if (!p.is_owner)
    return `<p>${e(uiText("Nur der Eigentümer kann Freigaben verwalten."))}</p>`;
  return `<section class="panel panel-body"><h2>${e(uiText("Sichtbarkeit & Freigaben"))}</h2><p>${e(uiText("Ohne Freigaben ist der Entwurf nur für dich sichtbar, auch nicht für andere Administratoren. Freigaben gelten für diesen Entwurf und alle seine Tabellen und SQL-Exporte."))}</p><p class="muted small">${e(uiText("Lesen erlaubt Anzeigen und Exportieren. Bearbeiten erlaubt Modelländerungen; Freigaben und Löschen bleiben beim Eigentümer. Änderungen an der Auswahl werden erst beim Speichern wirksam."))}</p><form id="tool-user-search" class="tool-filters"><input name="q" type="search" maxlength="190" value="${e(s.query)}" placeholder="${e(uiText("Benutzername oder Anzeigename"))}" aria-label="${e(uiText("Benutzer suchen"))}"><button type="submit" class="btn">${e(uiText("Benutzer suchen"))}</button></form><div class="tool-user-results">${s.users
    .filter((u) => !s.grants.some((g) => g.user_id === u.id))
    .map(
      (u) =>
        `<div class="dwh-relation"><span>${e(u.display_name)} <small>${e(u.username)}</small></span>${toolButton("Hinzufügen", "share-add", String(u.id))}</div>`,
    )
    .join(
      "",
    )}</div><form id="tool-sharing-form"><div class="tool-sharing-list">${s.grants.map((g) => `<div class="dwh-relation"><span>${e(g.display_name)} <small>${e(g.username)}${g.active === false ? " · " + e(uiText("Deaktiviert")) : ""}</small></span><div class="actions"><select data-tool-grant="${g.user_id}" aria-label="${e(uiText("Freigabe für {0}", g.display_name))}"><option value="read" ${!g.edit ? "selected" : ""}>${e(uiText("Lesen"))}</option><option value="edit" ${g.edit ? "selected" : ""}>${e(uiText("Bearbeiten"))}</option></select>${toolButton("Entfernen", "share-remove", String(g.user_id))}</div></div>`).join("") || `<p>${e(uiText("Keine Freigaben ausgewählt: privat."))}</p>`}</div><div id="form-error" class="error-text" role="alert"></div><div class="actions"><button type="submit" class="btn primary">${e(uiText("Freigaben speichern"))}</button>${p.shared ? toolButton("Privat machen", "private") : ""}</div></form></section>`;
}
async function toolFetchSql(download = false) {
  const p = state.toolDesign,
    mode = state.toolSqlMode || "schema";
  if (
    mode === "drop" &&
    !confirm(
      uiText(
        "DROP DATABASE entfernt die Datenbank {0} und alle Daten, wenn du dieses Skript ausführst. Skript erzeugen?",
        p.database_name,
      ),
    )
  )
    return;
  const response = await fetch(
    `/api/tools/designs/${p.id}/export?format=sql&mode=${mode}`,
    { credentials: "same-origin", headers: { "Accept-Language": uiLocale } },
  );
  if (!response.ok) {
    const error = await response.json();
    throw Error(error.detail || uiText("Bitte die Eingaben prüfen."));
  }
  const sql = await response.text();
  if (download) {
    const url = URL.createObjectURL(
        new Blob([sql], { type: "application/sql" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `databasedoc-${p.database_name}-${mode}.sql`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } else if (
    state.view === "tool-design" &&
    state.toolDesign.id === p.id &&
    state.toolDesign.version === p.version &&
    (state.toolSqlMode || "schema") === mode
  ) {
    state.toolSql = sql;
    renderToolDesign();
  }
}
async function toolsClick(button) {
  const a = button.dataset.action,
    id = button.dataset.id,
    p = state.toolDesign;
  if (a === "tool-new") toolDesignModal();
  if (a === "tool-open") await navigate("tool-design", id);
  if (a === "tool-reload")
    await navigate("tool-design", p.id, {
      tab: state.toolTab,
      table: state.toolTableId || "",
    });
  if (a === "tool-settings") toolDesignModal(true);
  if (a === "tool-tab") {
    state.toolTab = button.dataset.tab;
    renderToolDesign();
    history.replaceState(null, "", `#tool-design/${p.id}?tab=${state.toolTab}`);
  }
  if (a === "tool-table") {
    state.toolTableId = id;
    renderToolDesign();
    history.replaceState(
      null,
      "",
      `#tool-design/${p.id}?tab=model&table=${id}`,
    );
  }
  if (a === "tool-add-table" || a === "tool-edit-table")
    toolTableModal(a === "tool-edit-table");
  if (a === "tool-add-column" || a === "tool-edit-column")
    toolColumnModal(id || null);
  if (a === "tool-add-relation") toolRelationModal();
  if (
    a === "tool-remove-table" &&
    confirm(
      uiText(
        "Tabelle {0} und ihre Beziehungen aus dem Entwurf entfernen?",
        toolTable().name,
      ),
    )
  ) {
    const body = toolBody(),
      tableId = toolTable().id;
    body.tables = body.tables.filter((t) => t.id !== tableId);
    for (const t of body.tables)
      t.relations = t.relations.filter((r) => r.target_table_id !== tableId);
    await toolSave(body);
  }
  if (a === "tool-remove-relation") {
    const body = toolBody();
    body.tables.find((t) => t.id === toolTable().id).relations =
      toolTable().relations.filter((r) => r.id !== id);
    await toolSave(body);
  }
  if (
    a === "tool-remove-column" &&
    confirm(
      uiText(
        "Spalte und alle betroffenen Beziehungen aus dem Entwurf entfernen?",
      ),
    )
  ) {
    const body = toolBody(),
      ctx = state.toolEditContext;
    toolCheckContext();
    const table = body.tables.find((t) => t.id === ctx.tableId),
      column = table.columns.find((c) => c.id === ctx.columnId);
    table.columns = table.columns.filter((c) => c.id !== ctx.columnId);
    for (const t of body.tables)
      t.relations = t.relations.filter(
        (r) =>
          !(t.id === table.id && r.columns.includes(column.name)) &&
          !(
            r.target_table_id === table.id &&
            r.target_columns.includes(column.name)
          ),
      );
    await toolSave(body);
    modal.close();
  }
  if (a === "tool-sql-preview" || a === "tool-sql-download")
    await toolFetchSql(a === "tool-sql-download");
  if (a === "tool-json")
    location.href = `/api/tools/designs/${p.id}/export?format=json`;
  if (
    a === "tool-delete" &&
    confirm(
      uiText(
        "Diesen Entwurf und alle Freigaben löschen? Die echte Datenbank bleibt unverändert.",
      ),
    )
  ) {
    await api(`/api/tools/designs/${p.id}?version=${p.version}`, "DELETE");
    await navigate("tools");
  }
  if (a === "tool-share-add") {
    const u = state.toolSharing.users.find((u) => u.id === Number(id));
    state.toolSharing.grants.push({
      user_id: u.id,
      display_name: u.display_name,
      username: u.username,
      edit: false,
    });
    renderToolDesign();
  }
  if (a === "tool-share-remove") {
    state.toolSharing.grants = state.toolSharing.grants.filter(
      (g) => g.user_id !== Number(id),
    );
    renderToolDesign();
  }
  if (
    a === "tool-private" &&
    confirm(
      uiText("Alle Freigaben zurückziehen und den Entwurf privat machen?"),
    )
  ) {
    state.toolDesign = await api(`/api/tools/designs/${p.id}/sharing`, "PUT", {
      version: p.version,
      grants: [],
    });
    renderToolDesign();
  }
}
function toolCheckContext() {
  const c = state.toolEditContext,
    p = state.toolDesign;
  if (c.id !== p.id || c.version !== p.version)
    throw Error(
      uiText(
        "Der Entwurf wurde inzwischen geändert. Bitte neu laden und die Änderungen zusammenführen.",
      ),
    );
}
async function toolsSubmit(form) {
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const data = Object.fromEntries(new FormData(form));
    if (form.id === "tool-user-search") {
      const p = state.toolDesign,
        s = state.toolSharing;
      s.query = data.q;
      s.users = await api(
        `/api/tools/designs/${p.id}/users?q=${encodeURIComponent(data.q)}`,
      );
      if (
        state.view === "tool-design" &&
        state.toolDesign.id === p.id &&
        state.toolTab === "sharing"
      )
        renderToolDesign();
      return;
    }
    if (form.id === "tool-sharing-form") {
      state.toolDesign = await api(
        `/api/tools/designs/${state.toolDesign.id}/sharing`,
        "PUT",
        {
          version: state.toolSharing.version,
          grants: state.toolSharing.grants.map((g) => ({
            user_id: g.user_id,
            edit: g.edit,
          })),
        },
      );
      renderToolDesign();
      toast(uiText("Freigaben gespeichert."));
      return;
    }
    if (form.id === "tool-design-form") {
      if (form.dataset.edit === "true") {
        toolCheckContext();
        await toolSave({ ...toolBody(), ...data });
      } else {
        const created = await api("/api/tools/designs", "POST", {
          ...data,
          tables: [],
        });
        await navigate("tool-design", created.id);
      }
      modal.close();
      return;
    }
    toolCheckContext();
    const body = toolBody(),
      ctx = state.toolEditContext,
      t = body.tables.find((t) => t.id === ctx.tableId);
    if (form.id === "tool-table-form") {
      if (form.dataset.edit === "true") Object.assign(t, data);
      else {
        const table = { id: dwhUUID(), ...data, columns: [], relations: [] };
        body.tables.push(table);
        state.toolTableId = table.id;
      }
    }
    if (form.id === "tool-column-form") {
      const previous = t.columns.find((c) => c.id === ctx.columnId),
        c = {
          id: previous?.id || dwhUUID(),
          ...data,
          length: Number(data.length),
          precision: Number(data.precision),
          scale: Number(data.scale),
          nullable: form.elements.nullable.checked,
          primary_key: form.elements.primary_key.checked,
          identity: form.elements.identity.checked,
        };
      if (c.primary_key) c.nullable = false;
      if (previous) {
        t.columns[t.columns.indexOf(previous)] = c;
        if (previous.name !== c.name)
          for (const table of body.tables)
            for (const r of table.relations) {
              if (table.id === t.id)
                r.columns = r.columns.map((n) =>
                  n === previous.name ? c.name : n,
                );
              if (r.target_table_id === t.id)
                r.target_columns = r.target_columns.map((n) =>
                  n === previous.name ? c.name : n,
                );
            }
      } else t.columns.push(c);
    }
    if (form.id === "tool-relation-form") {
      const target = body.tables.find((t) => t.id === data.target_table_id);
      t.relations.push({
        id: dwhUUID(),
        columns: data.columns
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        target_table_id: target.id,
        target_columns: target.columns
          .filter((c) => c.primary_key)
          .map((c) => c.name),
      });
    }
    await toolSave(body);
    modal.close();
  } catch (error) {
    let node = form.querySelector("#form-error");
    if (!node) {
      node = document.createElement("div");
      node.id = "form-error";
      node.className = "error-text";
      node.setAttribute("role", "alert");
      form.append(node);
    }
    node.textContent = error.message;
    submit.disabled = false;
  }
}
function toolsChange(target) {
  if (target.id === "tool-scope") toolsFilter();
  if (target.id === "tool-sql-mode") {
    state.toolSqlMode = target.value;
    state.toolSql = null;
    renderToolDesign();
  }
  if (target.dataset.toolGrant) {
    const grant = state.toolSharing.grants.find(
      (g) => g.user_id === Number(target.dataset.toolGrant),
    );
    grant.edit = target.value === "edit";
  }
  const form = target.closest("form");
  if (!form) return;
  if (form.id === "tool-design-form") {
    const kind = form.elements.target_kind.value,
      schema = form.elements.target_schema;
    schema.closest(".field").hidden = kind === "mariadb";
    if (kind === "mssql" && schema.value === "public") schema.value = "dbo";
    if (kind === "postgresql" && schema.value === "dbo")
      schema.value = "public";
  }
  if (form.id === "tool-column-form") {
    const type = form.elements.data_type.value;
    for (const name of ["length", "precision", "scale"])
      form.elements.namedItem(name).closest(".field").hidden =
        name === "length" ? type !== "varchar" : type !== "decimal";
    if (form.elements.identity.checked) {
      form.elements.primary_key.checked = true;
      if (!["int", "bigint"].includes(type))
        form.elements.data_type.value = "bigint";
    }
    if (form.elements.primary_key.checked)
      form.elements.nullable.checked = false;
  }
  if (form.id === "tool-relation-form")
    document.getElementById("tool-relation-key").textContent =
      state.toolDesign.tables
        .find((t) => t.id === form.elements.target_table_id.value)
        ?.columns.filter((c) => c.primary_key)
        .map((c) => c.name)
        .join(", ") || "";
}
