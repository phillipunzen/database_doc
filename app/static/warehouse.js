"use strict";
function dwhUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
const dwhEngines = {
  mssql: "SQL Server",
  postgresql: "PostgreSQL",
  mariadb: "MariaDB",
};
const dwhRoles = {
  staging: "Staging",
  dimension: "Dimension",
  fact: uiText("Fakt"),
  reference: uiText("Referenz"),
  aggregate: uiText("Aggregat"),
};
const dwhLayers = {
  raw: "Raw",
  staging: "Staging",
  core: "Core",
  mart: "Data Mart",
};
const dwhStatuses = {
  planned: uiText("Geplant"),
  in_progress: uiText("In Umsetzung"),
  implemented: uiText("Umgesetzt"),
  accepted: uiText("Fachlich abgenommen"),
};
const dwhPurposes = {
  attribute: uiText("Attribut"),
  measure: uiText("Kennzahl"),
  business_key: uiText("Fachlicher Schlüssel"),
  technical_key: uiText("Technischer Schlüssel"),
};
const dwhTypes = {
  int: "INT",
  bigint: "BIGINT",
  decimal: "DECIMAL",
  varchar: "VARCHAR / NVARCHAR",
  text: "TEXT",
  date: "DATE",
  datetime: "DATETIME / TIMESTAMP",
  boolean: "BOOLEAN / BIT",
  uuid: "UUID",
  binary: "BINARY",
};
function dwhOptions(items, selected) {
  return Object.entries(items)
    .map(
      ([id, label]) =>
        `<option value="${e(id)}" ${id === selected ? "selected" : ""}>${e(label)}</option>`,
    )
    .join("");
}
function dwhSelect(label, name, items, selected) {
  return `<div class="field"><label for="dwh-${name}">${label}</label><select id="dwh-${name}" name="${name}">${dwhOptions(items, selected)}</select></div>`;
}
function dwhArea(label, name, value, placeholder = "", length = 4000) {
  return `<div class="field"><label for="dwh-${name}">${label}</label><textarea id="dwh-${name}" name="${name}" rows="3" maxlength="${length}" placeholder="${e(placeholder)}">${e(value || "")}</textarea></div>`;
}
function dwhFooter(label = uiText("Speichern")) {
  return `<div id="form-error" class="error-text" role="alert"></div><div class="modal-footer"><button type="submit" class="btn primary">${label}</button></div>`;
}
function dwhBody() {
  const p = state.dwhProject;
  return Object.fromEntries(
    [
      "name",
      "goal",
      "target_kind",
      "target_schema",
      "target_source_id",
      "source_ids",
      "tables",
      "version",
    ].map((k) => [k, structuredClone(p[k])]),
  );
}
async function dwhSave(body) {
  const p = await api(`/api/dwh/projects/${state.dwhProject.id}`, "PUT", body);
  state.dwhProject = p;
  state.dwhComparison = null;
  modal.close();
  renderDwhProject();
  toast(uiText("DWH-Projekt gespeichert."));
}
function renderDwhProjects() {
  const projects = state.dwhProjects || [];
  shell(localize`<div class="page-head"><div><div class="eyebrow">Vom Quellsystem zum Zielmodell</div><h1>DWH-Projekte</h1><p>Data Warehouses konzipieren und ihre Umsetzung begleiten.</p></div>${state.user.role !== "viewer" ? localize`<button class="btn primary" data-action="dwh-create">${icon("plus")} Projekt anlegen</button>` : ""}</div>
    <div class="dwh-steps"><div><strong>01 · Konzeption</strong><span>Fachliche Ziele und Quellen</span></div><div><strong>02 · Zielmodell</strong><span>Fakten, Dimensionen und Feldzuordnungen</span></div><div><strong>03 · Umsetzung</strong><span>SQL-Entwurf und Fortschritt</span></div><div><strong>04 · Abgleich</strong><span>Sollmodell gegen gescanntes Ziel</span></div></div>
    <section class="panel"><div class="panel-head"><h2>Deine Projekte</h2><span class="badge neutral">${projects.length}</span></div>${projects.length ? localize`<div class="table-wrap"><table><thead><tr><th>Projekt / Ziel</th><th>Plattform</th><th>Zieltabellen</th><th>Umgesetzt</th><th></th></tr></thead><tbody>${projects.map((p) => localize`<tr><td><strong>${e(p.name)}</strong><div class="small muted dwh-excerpt">${e(p.goal || uiText("Fachliches Ziel noch offen"))}</div></td><td>${databaseLogo(p.target_kind)} ${e(dwhEngines[p.target_kind])}<div class="small muted">${e(p.target_schema)}</div></td><td>${p.table_count}</td><td>${p.implemented_count} / ${p.table_count}</td><td><button class="text-button" data-action="dwh-open" data-id="${p.id}">Projekt öffnen →</button></td></tr>`).join("")}</tbody></table></div>` : localize`<div class="empty">${icon("relations")}<h2>Dein erstes DWH-Projekt</h2><p>Wähle dokumentierte Quellen aus und entwickle daraus ein Zielmodell für SQL Server, PostgreSQL oder MariaDB.</p></div>`}</section>
    <div class="hint">${icon("info")}<span>Quellstrukturen liefern einen Ausgangspunkt. Fachliche Kennzahlen, Granularität, Historisierung und Ladeverfahren werden im Projekt festgelegt.</span></div>`);
}
function dwhProjectModal(edit = false) {
  const p = edit
    ? state.dwhProject
    : {
        name: "",
        goal: "",
        target_kind: "mssql",
        target_schema: "dbo",
        source_ids: [],
        target_source_id: null,
      };
  const sources = state.sources.filter((s) => s.can_edit);
  openModal(
    edit ? uiText("DWH-Projekt bearbeiten") : uiText("DWH-Projekt anlegen"),
    localize`<form id="dwh-project-form" data-edit="${edit}">
    ${field(uiText("Projektname"), "name", p.name, "text", 'required maxlength="190"')}
    ${dwhArea(uiText("Fachliches Ziel & Anforderungen"), "goal", p.goal, uiText("Welche Auswertungen, Kennzahlen und Historisierung werden benötigt?"), 10000)}
    <div class="form-grid">${dwhSelect(uiText("Zielplattform"), "target_kind", dwhEngines, p.target_kind)}${field(uiText("Zielschema / Zieldatenbank"), "target_schema", p.target_schema, "text", 'required maxlength="63" pattern="[A-Za-z_][A-Za-z0-9_]*"')}</div>
    <div class="field"><label for="dwh-source-ids">Quellen für die Konzeption</label><select id="dwh-source-ids" name="source_ids" multiple size="5">${sources.map((s) => `<option value="${s.id}" ${p.source_ids.includes(s.id) ? "selected" : ""}>${e(s.name)} · ${e(names[s.kind])}</option>`).join("")}</select><small>Mehrfachauswahl möglich. Bestehende Feldzuordnungen benötigen ihre jeweilige Quelle.</small></div>
    <div class="field"><label for="dwh-target-source">Zieldatenquelle für Soll-Ist-Vergleich</label><select id="dwh-target-source" name="target_source_id"><option value="">Noch nicht verbunden</option>${sources
      .filter((s) => s.kind === p.target_kind)
      .map(
        (s) =>
          `<option value="${s.id}" ${p.target_source_id === s.id ? "selected" : ""}>${e(s.name)}</option>`,
      )
      .join(
        "",
      )}</select><small>Optional: Hinterlege und scanne das umgesetzte DWH als Datenquelle, um es mit dem Plan zu vergleichen.</small></div>
    <p class="muted small">Projektrechte folgen den Freigaben aller zugeordneten Quellen einschließlich des Ziels. Projekte ohne Quellen sind nur für Ersteller und Administratoren sichtbar.</p>${edit ? localize('<button type="button" class="text-button danger" data-action="dwh-delete-project">Projekt entfernen</button>') : ""}${dwhFooter(edit ? uiText("Projekt speichern") : uiText("Projekt anlegen"))}</form>`,
  );
}
function renderDwhProject() {
  const p = state.dwhProject;
  const tab = state.dwhTab || "overview";
  shell(localize`<button class="back" data-action="nav" data-view="warehouse">${icon("back")} Alle DWH-Projekte</button><div class="page-head"><div><div class="eyebrow">${e(dwhEngines[p.target_kind])} · ${e(p.target_schema)}</div><h1 class="dwh-project-title">${e(p.name)}</h1><p>Zielmodell und Umsetzung · Projektversion ${p.version}</p></div><div class="actions"><button class="btn" data-action="dwh-reload">${icon("refresh")} Neu laden</button><button class="btn" data-action="dwh-export" data-format="markdown">${icon("download")} Dokumentation</button><button class="btn" data-action="dwh-export" data-format="json">JSON</button><button class="btn primary" data-action="dwh-export" data-format="sql">${icon("download")} SQL-Entwurf</button>${p.can_edit ? localize('<button class="btn" data-action="dwh-settings">Projekt bearbeiten</button>') : ""}</div></div>
    ${tabs(
      [
        ["overview", uiText("Konzeption"), "file"],
        ["model", uiText("Zielmodell"), "relations"],
        ["mappings", uiText("Feldzuordnungen"), "columns"],
        ["progress", uiText("Umsetzung"), "clock"],
        ["check", uiText("Soll-Ist-Vergleich"), "shield"],
      ],
      tab,
      "dwh-tab",
    )}
    ${tab === "model" ? dwhModelView() : tab === "mappings" ? dwhMappingView() : tab === "progress" ? dwhProgressView() : tab === "check" ? dwhCheckView() : dwhOverview()}`);
}
function dwhOverview() {
  const p = state.dwhProject;
  const count = (role) => p.tables.filter((t) => t.role === role).length;
  const issues = [...p.issues, ...p.mapping_issues];
  return localize`<div class="stats">${stat(uiText("Zieltabellen"), p.tables.length, "table", uiText("Geplantes Warehouse"))}${stat(uiText("Fakten"), count("fact"), "grid", uiText("Ereignisse und Kennzahlen"))}${stat(uiText("Dimensionen"), count("dimension"), "relations", uiText("Fachlicher Kontext"))}${stat(uiText("Umgesetzt"), p.implemented_count, "clock", uiText("Manuell gemeldeter Fortschritt"))}</div>
    <div class="info-grid"><section class="panel"><div class="panel-head"><h2>Fachliche Anforderungen</h2></div><div class="panel-body"><p class="dwh-prose">${e(p.goal || uiText("Halte im Projektziel fest, welche Auswertungen und Kennzahlen benötigt werden, wie lange Daten historisiert werden und wie aktuell sie sein müssen."))}</p><h3 style="margin-top:24px">Projektquellen</h3><div class="tag-list" style="margin-top:12px">${p.source_ids.map((id) => `<span class="tag">${e(state.sources.find((s) => s.id === id)?.name || uiText("Quelle #") + id)}</span>`).join("") || localize('<span class="muted">Noch keine Quellen ausgewählt</span>')}</div><p class="small muted" style="margin-top:18px">Ziel für den Abgleich: ${e(state.sources.find((s) => s.id === p.target_source_id)?.name || uiText("Noch nicht verbunden"))}</p></div></section>
    <section class="panel"><div class="panel-head"><h2>Offene Modellierungsfragen</h2><span class="badge neutral">${issues.length}</span></div><div class="panel-body">${
      issues.length
        ? `<ul class="dwh-issues">${issues
            .slice(0, 30)
            .map((i) => `<li>${e(uiMessage(i))}</li>`)
            .join(
              "",
            )}</ul>${issues.length > 30 ? localize`<p class="muted small">${issues.length - 30} weitere Hinweise im Dokumentationsexport.</p>` : ""}`
        : localize(
            "<p>Die grundlegenden Modellierungsangaben sind vollständig.</p>",
          )
    }<p class="muted small" style="margin-top:18px">Diese Hinweise unterstützen die Planung. Die fachliche Abnahme und Datenqualität bewertet euer Team.</p></div></section></div>`;
}
function dwhSelectedTable() {
  const tables = state.dwhProject.tables;
  return tables.find((t) => t.id === state.dwhTableId) || tables[0];
}
function dwhModelView() {
  const p = state.dwhProject;
  const t = dwhSelectedTable();
  return `<div class="dwh-model-actions">${p.can_edit ? localize`<button class="btn primary" data-action="dwh-add-table">${icon("plus")} Zieltabelle anlegen</button><button class="btn" data-action="dwh-import">${icon("database")} Aus Quellstruktur übernehmen</button>` : localize('<span class="muted">Leserechte für dieses Zielmodell</span>')}</div>
    ${
      p.tables.length
        ? localize`<section class="panel dwh-diagram-panel"><div class="panel-head"><h2>Geplantes Datenmodell</h2><span class="small muted">${p.tables.reduce((n, t) => n + t.relations.length, 0)} geplante Beziehungen</span></div><div class="dwh-diagram">${dwhDiagram()}</div><div class="er-footer">Tabellen auswählen, um Details zu bearbeiten. ${p.tables.length > 30 ? uiText("Das Diagramm zeigt die ersten 30 Tabellen; Liste und SQL-Export enthalten alle Tabellen.") : ""}</div></section>
    <div class="schema-layout"><aside class="object-list"><div class="object-items">${p.tables.map((x) => `<button class="object-item ${x.id === t.id ? "active" : ""}" data-action="dwh-select-table" data-id="${x.id}">${icon("table")}<span>${e(x.name)}</span><small>${e(dwhRoles[x.role])}</small></button>`).join("")}</div></aside><section class="panel object-detail"><div class="panel-head"><div><div class="eyebrow">${e(dwhLayers[t.layer])} · ${e(dwhRoles[t.role])}</div><h2>${e(t.name)}</h2></div>${p.can_edit ? localize('<button class="btn" data-action="dwh-edit-table">Tabelle bearbeiten</button>') : ""}</div><div class="panel-body"><p class="dwh-prose">${e(t.description || uiText("Noch keine fachliche Beschreibung"))}</p>${info(uiText("Granularität"), e(t.grain || uiText("Noch offen")))}${info(uiText("Ladeverfahren"), t.load_mode === "incremental" ? uiText("Inkrementell") : uiText("Vollständig"))}${info(uiText("Ladestrategie"), e(t.load_strategy || uiText("Noch offen")))}</div>
    <div class="panel-head"><h3>Zielspalten</h3>${p.can_edit ? localize('<button class="btn" data-action="dwh-add-column">Spalte hinzufügen</button>') : ""}</div><div class="table-wrap"><table><thead><tr><th>Zielfeld</th><th>Typ</th><th>Zweck</th><th>NULL</th><th></th></tr></thead><tbody>${t.columns.map((c) => `<tr><td class="mono">${c.primary_key ? '<span class="key-label">PK</span>' : ""}${e(c.name)}${c.identity ? localize('<div class="small muted">Automatischer Schlüssel</div>') : ""}</td><td class="mono">${e(dwhTypeLabel(c))}</td><td>${e(dwhPurposes[c.purpose])}</td><td>${c.nullable ? uiText("Ja") : uiText("Nein")}</td><td>${p.can_edit ? localize`<button class="text-button" data-action="dwh-edit-column" data-id="${c.id}">Bearbeiten</button>` : ""}</td></tr>`).join("") || localize('<tr><td colspan="5">Noch keine Spalten geplant.</td></tr>')}</tbody></table></div>
    <div class="panel-head"><h3>Geplante Beziehungen</h3>${p.can_edit ? localize('<button class="btn" data-action="dwh-add-relation">Beziehung anlegen</button>') : ""}</div><div class="panel-body">${t.relations.map((r) => `<div class="dwh-relation"><span class="mono">${e(r.columns.join(", "))} → ${e(p.tables.find((x) => x.id === r.target_table_id)?.name)} (${e(r.target_columns.join(", "))})</span>${p.can_edit ? localize`<button class="text-button danger" data-action="dwh-remove-relation" data-id="${r.id}">Entfernen</button>` : ""}</div>`).join("") || localize('<p class="muted">Noch keine Beziehungen geplant.</p>')}</div>${p.can_edit ? localize('<div class="panel-body"><button class="text-button danger" data-action="dwh-remove-table">Zieltabelle aus dem Plan entfernen</button></div>') : ""}</section></div>`
        : localize(
            '<div class="empty"><h2>Entwickle dein Zielmodell</h2><p>Übernimm Quelltabellen als Ausgangspunkt für Staging oder lege fachliche Fakten und Dimensionen an.</p></div>',
          )
    }`;
}
function dwhTypeLabel(c) {
  return c.data_type === "varchar"
    ? `VARCHAR(${c.length})`
    : c.data_type === "decimal"
      ? `DECIMAL(${c.precision}, ${c.scale})`
      : c.data_type.toUpperCase();
}
function dwhDiagram() {
  const tables = state.dwhProject.tables.slice(0, 30),
    positions = new Map();
  const counts = [0, 0, 0];
  tables.forEach((t) => {
    const lane =
      t.role === "dimension"
        ? 0
        : ["fact", "aggregate"].includes(t.role)
          ? 1
          : 2;
    positions.set(t.id, { x: 25 + lane * 330, y: 25 + counts[lane]++ * 170 });
  });
  const height = Math.max(220, Math.max(...counts) * 170 + 30);
  const links = tables
    .flatMap((t) =>
      t.relations.map((r) => {
        const a = positions.get(t.id),
          b = positions.get(r.target_table_id);
        if (!b) return "";
        const sameLane = a.x === b.x;
        const left = a.x > b.x;
        const ax = sameLane ? a.x + 140 : left ? a.x : a.x + 280;
        const ay = sameLane ? a.y + 140 : a.y + 80;
        const bx = sameLane ? b.x + 140 : left ? b.x + 280 : b.x;
        const by = sameLane ? b.y : b.y + 80;
        const path = sameLane
          ? `M${ax},${ay} C${ax + 170},${ay + 40} ${bx + 170},${by - 40} ${bx},${by}`
          : `M${ax},${ay} C${(ax + bx) / 2},${ay} ${(ax + bx) / 2},${by} ${bx},${by}`;
        return `<path d="${path}" fill="none" stroke="#739b7c" stroke-width="2" marker-end="url(#dwh-arrow)"><title>${e(t.name)} → ${e(state.dwhProject.tables.find((x) => x.id === r.target_table_id)?.name)}: ${e(r.columns.join(", "))}</title></path>`;
      }),
    )
    .join("");
  const nodes = tables
    .map((t) => {
      const p = positions.get(t.id),
        selected = dwhSelectedTable()?.id === t.id;
      return `<g data-action="dwh-select-table" data-id="${t.id}" role="button" tabindex="0" aria-label="${e(t.name)}" class="dwh-diagram-node"><rect x="${p.x}" y="${p.y}" width="280" height="140" rx="8" fill="${t.role === "fact" ? "#edf4df" : "white"}" stroke="${selected ? "#276256" : "#cddbd2"}" stroke-width="${selected ? 2 : 1}"/><text x="${p.x + 14}" y="${p.y + 23}" fill="#6d8077" font-size="11">${e(dwhRoles[t.role])} · ${e(dwhLayers[t.layer])}</text><text x="${p.x + 14}" y="${p.y + 45}" font-size="14" font-weight="bold" fill="#163a35">${e(t.name.length > 29 ? t.name.slice(0, 28) + "…" : t.name)}<title>${e(t.name)}</title></text>${t.columns
        .slice(0, 4)
        .map(
          (c, i) =>
            `<text x="${p.x + 14}" y="${p.y + 66 + i * 17}" fill="#425950" font-size="11">${c.primary_key ? "PK · " : ""}${e(c.name.slice(0, 34))}</text>`,
        )
        .join("")}</g>`;
    })
    .join("");
  return localize`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" role="img" aria-label="Geplantes DWH-Modell"><defs><marker id="dwh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="#739b7c"/></marker></defs>${links}${nodes}</svg>`;
}
function dwhTableModal(edit = false) {
  const t = edit
    ? dwhSelectedTable()
    : {
        name: "",
        role: "dimension",
        layer: "core",
        grain: "",
        description: "",
        load_mode: "full",
        load_strategy: "",
        status: "planned",
      };
  openModal(
    edit ? uiText("Zieltabelle bearbeiten") : uiText("Zieltabelle anlegen"),
    `<form id="dwh-table-form" data-id="${edit ? t.id : ""}">${field(uiText("Tabellenname"), "name", t.name, "text", localize('required maxlength="63" pattern="[A-Za-z_][A-Za-z0-9_]*" placeholder="dim_customer oder fact_sales"'))}<div class="form-grid">${dwhSelect(uiText("Modellrolle"), "role", dwhRoles, t.role)}${dwhSelect(uiText("Warehouse-Schicht"), "layer", dwhLayers, t.layer)}</div>${dwhArea(uiText("Granularität – was beschreibt eine Zeile?"), "grain", t.grain, uiText("Eine Zeile je Bestellposition oder je Kunde und Gültigkeitszeitraum"), 2000)}${dwhArea(uiText("Fachliche Beschreibung"), "description", t.description)}<div class="form-grid">${dwhSelect(uiText("Ladeverfahren"), "load_mode", { full: uiText("Vollständig"), incremental: uiText("Inkrementell") }, t.load_mode)}${dwhSelect(uiText("Umsetzungsstatus"), "status", dwhStatuses, t.status)}</div>${dwhArea(uiText("Ladestrategie & Historisierung"), "load_strategy", t.load_strategy, uiText("Z. B. täglicher Lauf, Änderungserkennung über updated_at, SCD Typ 2, Löschbehandlung und Wiederanlauf"))}${dwhFooter()}</form>`,
  );
}
async function dwhColumnModal(columnId = null) {
  const p = state.dwhProject,
    t = dwhSelectedTable();
  const c = t.columns.find((c) => c.id === columnId) || {
    name: "",
    data_type: "varchar",
    length: 255,
    precision: 18,
    scale: 2,
    nullable: true,
    primary_key: false,
    identity: false,
    purpose: "attribute",
    description: "",
    transformation: "",
    mapping: null,
  };
  state.dwhColumnContext = {
    projectId: p.id,
    tableId: t.id,
    columnId,
    version: p.version,
    mapping: c.mapping ? structuredClone(c.mapping) : null,
  };
  openModal(
    columnId ? uiText("Zielspalte bearbeiten") : uiText("Zielspalte anlegen"),
    localize`<form id="dwh-column-form">${field(uiText("Spaltenname"), "name", c.name, "text", 'required maxlength="63" pattern="[A-Za-z_][A-Za-z0-9_]*"')}<div class="form-grid">${dwhSelect(uiText("Datentyp"), "data_type", dwhTypes, c.data_type)}${dwhSelect(uiText("Fachlicher Zweck"), "purpose", dwhPurposes, c.purpose)}</div><div class="form-grid">${field(uiText("Textlänge"), "length", c.length, "number", 'required min="1" max="4000"')}${field(uiText("Dezimalpräzision"), "precision", c.precision, "number", 'required min="1" max="38"')}${field(uiText("Dezimalstellen"), "scale", c.scale, "number", 'required min="0" max="38"')}</div><div class="dwh-checks"><label><input type="checkbox" name="nullable" ${c.nullable ? "checked" : ""}> NULL erlaubt</label><label><input type="checkbox" name="primary_key" ${c.primary_key ? "checked" : ""}> Primärschlüssel</label><label><input type="checkbox" name="identity" ${c.identity ? "checked" : ""}> Automatischer Schlüssel</label></div>
    <div class="field"><label for="dwh-mapping-source">Quellzuordnung</label><select id="dwh-mapping-source"><option value="">Abgeleitet / manuell</option>${p.source_ids.map((id) => `<option value="${id}" ${c.mapping?.source_id === id ? "selected" : ""}>${e(state.sources.find((s) => s.id === id)?.name || uiText("Quelle #") + id)}</option>`).join("")}</select><small id="dwh-mapping-saved">${c.mapping ? localize`Gespeicherte Zuordnung aus Scan #${c.mapping.snapshot_id}: ${e(c.mapping.column_name)}. Eine neue Auswahl verwendet den aktuellen Scan.` : uiText("Wähle Quelle, Objekt und Feld oder beschreibe eine Ableitung.")}</small></div><div id="dwh-mapping-fields"></div>
    ${dwhArea(uiText("Transformation / Ableitungsregel"), "transformation", c.transformation, uiText("Fachliche Regel, z. B. Netto = Menge × Einzelpreis. Wird dokumentiert, nicht ausgeführt."), 2000)}${dwhArea(uiText("Beschreibung"), "description", c.description, uiText("Bedeutung, Einheit und fachliche Definition"), 2000)}${columnId ? localize('<button type="button" class="text-button danger" data-action="dwh-remove-column">Spalte aus dem Plan entfernen</button>') : ""}${dwhFooter()}</form>`,
  );
  dwhTypeFields();
}
function dwhTypeFields() {
  const form = document.getElementById("dwh-column-form");
  if (!form) return;
  const type = form.querySelector('[name="data_type"]').value;
  for (const name of ["length", "precision", "scale"]) {
    form.querySelector(`[name="${name}"]`).closest(".field").hidden =
      name === "length" ? type !== "varchar" : type !== "decimal";
  }
}
async function dwhMappingSource() {
  const source = document.getElementById("dwh-mapping-source");
  const id = Number(source.value);
  const context = state.dwhColumnContext;
  context.mapping = null;
  document.getElementById("dwh-mapping-saved").textContent = "";
  document.getElementById("dwh-mapping-fields").innerHTML = "";
  if (!id) return;
  const snap = await api(`/api/sources/${id}/snapshot`);
  if (
    !modal.open ||
    state.dwhColumnContext !== context ||
    Number(source.value) !== id
  )
    return;
  context.snapshot = snap;
  document.getElementById("dwh-mapping-fields").innerHTML =
    localize`<div class="field"><label for="dwh-mapping-table">Quellobjekt</label><select id="dwh-mapping-table"><option value="">Objekt wählen</option>${snap.payload.tables.map((t, i) => `<option value="${i}">${e(t.schema ? t.schema + "." + t.name : t.name)}</option>`).join("")}</select></div><div class="field"><label for="dwh-mapping-column">Quellfeld</label><select id="dwh-mapping-column"><option value="">Feld wählen</option></select></div>`;
}
function dwhMappingColumn() {
  const context = state.dwhColumnContext;
  const ti = document.getElementById("dwh-mapping-table").value;
  const name = document.getElementById("dwh-mapping-column").value;
  context.mapping =
    ti !== "" && name
      ? {
          source_id: Number(
            document.getElementById("dwh-mapping-source").value,
          ),
          snapshot_id: context.snapshot.id,
          table_key: context.snapshot.payload.tables[Number(ti)].key,
          column_name: name,
        }
      : null;
}
function dwhRelationModal() {
  const t = dwhSelectedTable();
  const targets = state.dwhProject.tables.filter((x) =>
    x.columns.some((c) => c.primary_key),
  );
  openModal(
    uiText("Beziehung planen"),
    localize`<form id="dwh-relation-form"><div class="field"><label for="dwh-relation-columns">Spalten dieser Tabelle</label><input id="dwh-relation-columns" name="columns" required placeholder="customer_id oder key_a, key_b"><small>Vorhandene Zielspalten, durch Kommas getrennt. Reihenfolge entspricht dem Ziel-Primärschlüssel.</small></div>${dwhSelect(uiText("Referenzierte Tabelle"), "target_table_id", Object.fromEntries(targets.map((x) => [x.id, x.name])), targets[0]?.id)}<p class="small muted" id="dwh-relation-key">${e(
      targets[0]?.columns
        .filter((c) => c.primary_key)
        .map((c) => c.name)
        .join(", ") ||
        uiText("Die Zieltabelle benötigt einen Primärschlüssel."),
    )}</p>${dwhFooter(uiText("Beziehung speichern"))}</form>`,
  );
}
async function dwhImportModal() {
  const p = state.dwhProject;
  openModal(
    uiText("Quellstruktur als Staging übernehmen"),
    localize`<form id="dwh-import-form">${dwhSelect(uiText("Projektquelle"), "import_source", Object.fromEntries(p.source_ids.map((id) => [id, state.sources.find((s) => s.id === id)?.name || uiText("Quelle #") + id])), String(p.source_ids[0] || ""))}<div id="dwh-import-tables"><p class="muted">Quellobjekte werden geladen …</p></div><p class="muted small">Spalten und Feldzuordnungen werden aus dem aktuellen Scan übernommen. Zieltypen sind Vorschläge; Modellrolle, Kennzahlen, Historisierung und Beziehungen legst du anschließend fest.</p>${dwhFooter(uiText("Als Staging übernehmen"))}</form>`,
  );
  await dwhImportTables();
}
async function dwhImportTables() {
  const select = document.getElementById("dwh-import_source");
  const id = Number(select.value);
  if (!id) {
    document.getElementById("dwh-import-tables").innerHTML = localize(
      "<p>Wähle zuerst Projektquellen unter „Projekt bearbeiten“ aus.</p>",
    );
    return;
  }
  const snap = await api(`/api/sources/${id}/snapshot`);
  if (!modal.open || Number(select.value) !== id) return;
  document.getElementById("dwh-import-tables").innerHTML =
    localize`<div class="field"><label for="dwh-import-keys">Quellobjekte · Scan #${snap.id}</label><select id="dwh-import-keys" name="table_keys" multiple required size="8">${snap.payload.tables.map((t) => localize`<option value="${e(t.key)}">${e(t.schema ? t.schema + "." + t.name : t.name)} · ${t.columns.length} Felder</option>`).join("")}</select><small>Bis zu 50 Objekte je Übernahme; Mehrfachauswahl möglich.</small></div>`;
}
function dwhMappingView() {
  const p = state.dwhProject;
  return localize`<section class="panel"><div class="panel-head"><div><h2>Quelle → Zielfeld</h2><p class="muted small">Gespeicherter Quellscan, fachlicher Zweck und Transformation je Zielspalte.</p></div></div><div class="table-wrap"><table><thead><tr><th>Zieltabelle / Feld</th><th>Quelle / Scan</th><th>Quellfeld</th><th>Transformation</th></tr></thead><tbody>${p.tables.flatMap((t) => t.columns.map((c) => `<tr><td><strong>${e(t.name)}</strong><div class="mono">${e(c.name)}</div><div class="small muted">${e(dwhPurposes[c.purpose])}</div></td><td>${c.mapping ? `${e(state.sources.find((s) => s.id === c.mapping.source_id)?.name || uiText("Quelle #") + c.mapping.source_id)}<div class="small muted">Scan #${c.mapping.snapshot_id}</div>` : uiText("Abgeleitet / manuell")}</td><td class="mono">${c.mapping ? `${e(JSON.parse(c.mapping.table_key).filter(Boolean).join("."))}<div>${e(c.mapping.column_name)}</div>` : "—"}</td><td class="dwh-prose">${e(c.transformation || "—")}</td></tr>`)).join("") || localize('<tr><td colspan="4">Lege Zielspalten an oder übernimm eine Quellstruktur.</td></tr>')}</tbody></table></div></section>${p.mapping_issues.length ? `<div class="hint">${icon("info")}<span>${p.mapping_issues.map(e).join("<br>")}</span></div>` : ""}`;
}
function dwhProgressView() {
  const p = state.dwhProject;
  return localize`<section class="panel"><div class="panel-head"><div><h2>Umsetzung begleiten</h2><p class="muted small">Status je Zieltabelle; „Fachlich abgenommen“ ist eine Entscheidung eures Teams.</p></div></div><div class="table-wrap"><table><thead><tr><th>Zieltabelle</th><th>Modellrolle</th><th>Laden / Historisierung</th><th>Status</th></tr></thead><tbody>${p.tables.map((t) => localize`<tr><td><strong>${e(t.name)}</strong><div class="small muted">${e(t.grain || uiText("Granularität offen"))}</div></td><td>${e(dwhRoles[t.role])}</td><td class="dwh-prose">${e(t.load_strategy || uiText("Ladestrategie noch offen"))}</td><td><select aria-label="Umsetzungsstatus ${e(t.name)}" data-dwh-status="${t.id}" ${p.can_edit ? "" : "disabled"}>${dwhOptions(dwhStatuses, t.status)}</select></td></tr>`).join("") || localize('<tr><td colspan="4">Noch keine Zieltabellen geplant.</td></tr>')}</tbody></table></div></section><div class="hint">${icon("info")}<span>SQL-Export erstellt einen Entwurf für die initiale Tabellenstruktur. Ladejobs, Transformationen und Datenqualitätsprüfungen werden in dieser Version geplant und außerhalb von DatabaseDoc umgesetzt.</span></div>`;
}
function dwhCheckView() {
  const p = state.dwhProject,
    c = state.dwhComparison;
  return localize`<section class="panel"><div class="panel-head"><div><h2>Geplantes Modell gegen Zielsystem</h2><p class="muted small">${e(state.sources.find((s) => s.id === p.target_source_id)?.name || uiText("Noch keine Zieldatenquelle zugeordnet"))}</p></div><button class="btn primary" data-action="dwh-compare" ${p.target_source_id ? "" : "disabled"}>${icon("shield")} Jetzt vergleichen</button></div><div class="panel-body"><p>Nach der Umsetzung das Zielsystem als Datenquelle hinterlegen und scannen. Der Vergleich prüft Tabellen, Spalten, Datentypen, NULL-Zulässigkeit, Primärschlüssel und geplante Beziehungen.</p>${c ? localize`<p style="margin:18px 0"><strong>${c.matched} / ${c.total} Tabellen entsprechen dem Plan</strong> · Scan #${c.snapshot_id} vom ${e(dt(c.created))}</p>${c.tables.map((t) => `<div class="dwh-check-result"><h3>${e(t.table_name)} <span class="badge ${t.matches ? "" : "error"}">${t.matches ? uiText("Struktur entspricht dem Plan") : uiText("Abweichungen")}</span></h3>${t.issues.length ? `<ul class="dwh-issues">${t.issues.map((i) => `<li>${e(uiMessage(i))}</li>`).join("")}</ul>` : ""}${t.extra_columns.length ? localize`<p class="muted small">Zusätzliche Spalten: ${e(t.extra_columns.join(", "))}</p>` : ""}</div>`).join("")}${c.extra_tables.length ? localize`<p>Zusätzliche Zieltabellen: ${e(c.extra_tables.join(", "))}</p>` : ""}<p class="small muted">${e(c.limitations)}</p>` : ""}</div></section>`;
}
async function dwhDownload(format) {
  const id = state.dwhProject.id;
  const response = await fetch(
    `/api/dwh/projects/${id}/export?format=${encodeURIComponent(format)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 401) {
      state.user = null;
      await showLogin();
    }
    throw new Error(
      typeof err.detail === "string"
        ? err.detail
        : uiText("Export fehlgeschlagen."),
    );
  }
  const url = URL.createObjectURL(await response.blob()),
    a = document.createElement("a");
  a.href = url;
  a.download = `databasedoc-dwh-${id}.${format === "markdown" ? "md" : format}`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function warehouseClick(button) {
  const action = button.dataset.action;
  const p = state.dwhProject;
  if (action === "dwh-create") dwhProjectModal();
  if (action === "dwh-open")
    await navigate("warehouse-project", button.dataset.id);
  if (action === "dwh-settings") dwhProjectModal(true);
  if (action === "dwh-delete-project") {
    modal.close();
    openModal(
      uiText("DWH-Projekt entfernen"),
      localize`<p>Das Projekt „${e(p.name)}“ mit allen Zieltabellen, Feldzuordnungen und Statusangaben aus DatabaseDoc entfernen?</p><p class="muted small">Quell- und Zieldatenbanken bleiben erhalten.</p><button class="btn danger" data-action="dwh-confirm-delete-project">Projekt entfernen</button>`,
    );
  }
  if (action === "dwh-confirm-delete-project") {
    await api(`/api/dwh/projects/${p.id}?version=${p.version}`, "DELETE");
    modal.close();
    await navigate("warehouse");
    toast(uiText("DWH-Projekt entfernt."));
  }

  if (action === "dwh-reload") {
    state.dwhProject = await api(`/api/dwh/projects/${p.id}`);
    state.dwhComparison = null;
    renderDwhProject();
  }
  if (action === "dwh-tab") {
    state.dwhTab = button.dataset.tab;
    renderDwhProject();
  }
  if (action === "dwh-add-table") dwhTableModal();
  if (action === "dwh-edit-table") dwhTableModal(true);
  if (action === "dwh-select-table") {
    state.dwhTableId = button.dataset.id;
    state.dwhTab = "model";
    renderDwhProject();
  }
  if (action === "dwh-add-column") await dwhColumnModal();
  if (action === "dwh-edit-column") await dwhColumnModal(button.dataset.id);
  if (action === "dwh-add-relation") dwhRelationModal();
  if (action === "dwh-import") await dwhImportModal();
  if (action === "dwh-export") await dwhDownload(button.dataset.format);
  if (action === "dwh-compare") {
    button.disabled = true;
    try {
      state.dwhComparison = await api(`/api/dwh/projects/${p.id}/compare`);
      renderDwhProject();
    } finally {
      button.disabled = false;
    }
  }
  if (action === "dwh-remove-relation") {
    const body = dwhBody(),
      t = body.tables.find((x) => x.id === dwhSelectedTable().id);
    t.relations = t.relations.filter((r) => r.id !== button.dataset.id);
    await dwhSave(body);
  }
  if (action === "dwh-remove-column") {
    const context = state.dwhColumnContext,
      body = dwhBody(),
      t = body.tables.find((x) => x.id === context.tableId);
    const column = t.columns.find((c) => c.id === context.columnId);
    if (
      t.relations.some((r) => r.columns.includes(column.name)) ||
      body.tables.some((x) =>
        x.relations.some(
          (r) =>
            r.target_table_id === t.id &&
            r.target_columns.includes(column.name),
        ),
      )
    )
      throw new Error(
        uiText("Bitte zuerst die Beziehungen dieser Spalte entfernen."),
      );
    t.columns = t.columns.filter((c) => c.id !== context.columnId);
    await dwhSave(body);
  }
  if (action === "dwh-remove-table") {
    const t = dwhSelectedTable();
    openModal(
      uiText("Zieltabelle entfernen"),
      localize`<p>${e(t.name)} mit ${t.columns.length} geplanten Spalten aus dem Projekt entfernen? Zugehörige geplante Beziehungen werden ebenfalls entfernt.</p><p class="muted small">Dieser Schritt ändert nur den Projektplan.</p><button class="btn danger" data-action="dwh-confirm-remove-table" data-id="${t.id}">Aus dem Plan entfernen</button>`,
    );
  }
  if (action === "dwh-confirm-remove-table") {
    const body = dwhBody();
    body.tables = body.tables.filter((t) => t.id !== button.dataset.id);
    body.tables.forEach((t) => {
      t.relations = t.relations.filter(
        (r) => r.target_table_id !== button.dataset.id,
      );
    });
    await dwhSave(body);
  }
}
async function warehouseSubmit(form) {
  const button = form.querySelector('[type="submit"]'),
    fd = new FormData(form),
    data = Object.fromEntries(fd);
  button.disabled = true;
  try {
    if (form.id === "dwh-project-form") {
      const edit = form.dataset.edit === "true";
      const body = edit ? dwhBody() : { tables: [] };
      Object.assign(body, {
        name: data.name,
        goal: data.goal,
        target_kind: data.target_kind,
        target_schema: data.target_schema,
        source_ids: fd.getAll("source_ids").map(Number),
        target_source_id: data.target_source_id
          ? Number(data.target_source_id)
          : null,
      });
      if (edit) await dwhSave(body);
      else {
        const p = await api("/api/dwh/projects", "POST", body);
        modal.close();
        await navigate("warehouse-project", p.id);
      }
    }
    if (form.id === "dwh-table-form") {
      const body = dwhBody();
      const t = body.tables.find((t) => t.id === form.dataset.id) || {
        id: dwhUUID(),
        columns: [],
        relations: [],
      };
      Object.assign(t, data);
      if (!form.dataset.id) {
        body.tables.push(t);
        state.dwhTableId = t.id;
      }
      await dwhSave(body);
    }
    if (form.id === "dwh-column-form") {
      const context = state.dwhColumnContext;
      if (
        context.projectId !== state.dwhProject.id ||
        context.version !== state.dwhProject.version
      )
        throw new Error(
          uiText(
            "Projekt wurde inzwischen geändert. Bitte Spalteneditor neu öffnen.",
          ),
        );
      if (
        document.getElementById("dwh-mapping-source").value &&
        !context.mapping
      )
        throw new Error(uiText("Bitte Quellobjekt und Quellfeld auswählen."));
      const body = dwhBody(),
        t = body.tables.find((t) => t.id === context.tableId);
      const c = t.columns.find((c) => c.id === context.columnId) || {
        id: dwhUUID(),
      };
      const oldName = c.name;
      Object.assign(c, {
        name: data.name,
        data_type: data.data_type,
        length: Number(data.length),
        precision: Number(data.precision),
        scale: Number(data.scale),
        nullable: data.nullable === "on",
        primary_key: data.primary_key === "on",
        identity: data.identity === "on",
        purpose: data.purpose,
        description: data.description,
        transformation: data.transformation,
        mapping: context.mapping,
      });
      if (!context.columnId) t.columns.push(c);
      if (oldName && oldName !== c.name) {
        t.relations.forEach((r) => {
          r.columns = r.columns.map((n) => (n === oldName ? c.name : n));
        });
        body.tables.forEach((x) =>
          x.relations
            .filter((r) => r.target_table_id === t.id)
            .forEach((r) => {
              r.target_columns = r.target_columns.map((n) =>
                n === oldName ? c.name : n,
              );
            }),
        );
      }
      await dwhSave(body);
    }
    if (form.id === "dwh-relation-form") {
      const body = dwhBody(),
        t = body.tables.find((x) => x.id === dwhSelectedTable().id),
        target = body.tables.find((x) => x.id === data.target_table_id);
      if (!target)
        throw new Error(
          uiText("Bitte eine Zieltabelle mit Primärschlüssel anlegen."),
        );
      t.relations.push({
        id: dwhUUID(),
        columns: data.columns
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean),
        target_table_id: target.id,
        target_columns: target.columns
          .filter((c) => c.primary_key)
          .map((c) => c.name),
      });
      await dwhSave(body);
    }
    if (form.id === "dwh-import-form") {
      const p = state.dwhProject;
      const result = await api(`/api/dwh/projects/${p.id}/import`, "POST", {
        version: p.version,
        source_id: Number(data.import_source),
        table_keys: fd.getAll("table_keys"),
      });
      state.dwhProject = result.project;
      state.dwhComparison = null;
      modal.close();
      renderDwhProject();
      toast(
        result.warnings.length
          ? uiText("Übernommen. Einige Datentypen bitte prüfen.")
          : uiText("Quellstruktur mit Feldzuordnungen übernommen."),
      );
      if (result.warnings.length)
        openModal(
          uiText("Zieltypen prüfen"),
          `<ul class="dwh-issues">${result.warnings.map((w) => `<li>${e(uiMessage(w))}</li>`).join("")}</ul>`,
        );
    }
  } catch (error) {
    const node = document.getElementById("form-error");
    if (node) node.textContent = error.message;
    else toast(error.message);
  } finally {
    button.disabled = false;
  }
}
async function warehouseChange(target) {
  try {
    if (target.id === "dwh-data_type") dwhTypeFields();
    if (target.id === "dwh-target_kind") {
      const schema = document.querySelector('[name="target_schema"]');
      if (["dbo", "public", "warehouse"].includes(schema.value))
        schema.value = {
          mssql: "dbo",
          postgresql: "public",
          mariadb: "warehouse",
        }[target.value];
      document.getElementById("dwh-target-source").innerHTML =
        localize('<option value="">Noch nicht verbunden</option>') +
        state.sources
          .filter((s) => s.can_edit && s.kind === target.value)
          .map((s) => `<option value="${s.id}">${e(s.name)}</option>`)
          .join("");
    }
    if (target.id === "dwh-mapping-source") await dwhMappingSource();
    if (target.id === "dwh-mapping-table") {
      state.dwhColumnContext.mapping = null;
      const t =
        target.value !== ""
          ? state.dwhColumnContext.snapshot.payload.tables[Number(target.value)]
          : null;
      document.getElementById("dwh-mapping-column").innerHTML =
        localize('<option value="">Feld wählen</option>') +
        (t?.columns || [])
          .map(
            (c) =>
              `<option value="${e(c.name)}">${e(c.name)} · ${e(c.type)}</option>`,
          )
          .join("");
    }
    if (target.id === "dwh-mapping-column") dwhMappingColumn();
    if (target.id === "dwh-import_source") await dwhImportTables();
    if (target.id === "dwh-target_table_id") {
      const t = state.dwhProject.tables.find((t) => t.id === target.value);
      document.getElementById("dwh-relation-key").textContent =
        "Ziel-Primärschlüssel: " +
        t.columns
          .filter((c) => c.primary_key)
          .map((c) => c.name)
          .join(", ");
    }
    if (target.dataset.dwhStatus) {
      const body = dwhBody();
      body.tables.find((t) => t.id === target.dataset.dwhStatus).status =
        target.value;
      target.disabled = true;
      try {
        await dwhSave(body);
      } catch (error) {
        target.disabled = false;
        target.value = state.dwhProject.tables.find(
          (t) => t.id === target.dataset.dwhStatus,
        ).status;
        throw error;
      }
    }
  } catch (error) {
    const node = modal.open ? document.getElementById("form-error") : null;
    if (node) node.textContent = error.message;
    else toast(error.message);
  }
}
document.addEventListener("keydown", (ev) => {
  const node = ev.target.closest(".dwh-diagram-node");
  if (node && ["Enter", " "].includes(ev.key)) {
    ev.preventDefault();
    warehouseClick(node).catch((err) => toast(err.message));
  }
});
