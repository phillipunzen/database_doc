"use strict";
function assessmentButton(
  label,
  action,
  id = "",
  extra = "",
  disabled = false,
) {
  return `<button type="button" class="btn" data-action="wa-${action}" data-id="${e(id)}" ${extra} ${disabled ? "disabled" : ""}>${e(uiText(label))}</button>`;
}
function warehouseAssessmentView() {
  const p = state.dwhProject,
    report =
      state.dwhAssessment?.project_id === p.id ? state.dwhAssessment : null;
  return `<section class="panel panel-body wa-intro"><h2>${e(uiText("DWH-Bestand & Hinweise"))}</h2><p>${e(uiText("Vergleiche das tatsächliche Warehouse mit deinem Entwurf und dem aktuellen Strukturwissen der Anwendungsquellen."))}</p><p class="small muted">${e(uiText("Der Soll-Ist-Vergleich gilt für die ausgewählte Zieldatenbank und das geplante Schema. Weitere Serverdatenbanken werden als Bestand angezeigt."))}</p><ol><li>${e(uiText("DWH-Verbindung im Datenquellenkatalog hinterlegen: Plattform, Server, Datenbank und Zugangsdaten. Für weitere Datenbanken auf dem Server jeweils eine Datenquelle hinzufügen."))}</li><li>${e(uiText("In den Warehouse-Einstellungen die DWH-Zieldatenbank für den Soll-Ist-Vergleich auswählen und die Anwendungsquellen zuordnen."))}</li><li>${e(uiText("Quellen und DWH scannen. Mit Bestand prüfen die gespeicherten Scans auswerten; automatische Scans stellst du in der jeweiligen Datenquelle ein."))}</li></ol><div class="actions">${assessmentButton("Bestand prüfen", "load")}${p.can_edit ? assessmentButton("DWH-Datenbank verbinden", "settings") : ""}${assessmentButton("Datenquellenkatalog öffnen", "catalog")}</div>${report ? `<p class="small muted">${e(uiText("Prüfung vom {0} · Projektversion {1}", dt(report.generated_at), report.project_version))}</p>` : `<p class="small muted">${e(uiText("Die Prüfung liest gespeicherte Metadaten und führt keine SQL- oder Ladejobs aus."))}</p>`}</section>${report ? `<section class="panel panel-body wa-server"><h2>${e(uiText("DWH-Server und Zieldatenbank"))}</h2>${report.target ? `<p><strong>${e(report.target.host)}:${e(report.target.port)}</strong> · ${e(dwhEngines[report.target.kind] || report.target.kind)}<br>${e(uiText("Vergleichsziel"))}: <strong>${e(report.target.database)}</strong> · ${e(uiText("Zielschema / Zieldatenbank"))}: ${e(p.target_schema)}</p>${assessmentSourceStatus(report.target)}<div class="actions">${assessmentButton("Zieldatenbank öffnen", "source", report.target.id)}${assessmentButton("ER-Diagramm öffnen", "er", report.target.id, "", !report.target.snapshot_id)}${report.target.can_scan ? assessmentButton("Zielstruktur scannen", "scan", report.target.id, "", ["queued", "running"].includes(report.target.job?.status)) : ""}</div>` : `<p>${e(uiText("Noch keine DWH-Zieldatenbank verbunden."))}</p>`}</section><div class="wa-stats"><div><strong>${report.server_databases.length}</strong><span>${e(uiText("Freigegebene DWH-Verbindungen"))}</span></div><div><strong>${report.sources.length}</strong><span>${e(uiText("Zugeordnete Anwendungsquellen"))}</span></div><div><strong>${report.comparison ? `${report.comparison.matched}/${report.comparison.total}` : "—"}</strong><span>${e(uiText("Tabellen gemäß Plan"))}</span></div><div><strong>${report.finding_counts.warning}</strong><span>${e(uiText("Struktur prüfen"))}</span></div></div>${assessmentInventory(report)}${assessmentSources(report)}<section class="panel"><div class="panel-head"><h2>${e(uiText("Prüfhinweise und nächste Schritte"))}</h2><select id="wa-severity" aria-label="${e(uiText("Hinweise filtern"))}"><option value="all">${e(uiText("Alle Hinweise"))}</option><option value="warning">${e(uiText("Struktur prüfen"))}</option><option value="info">${e(uiText("Dokumentation prüfen"))}</option></select></div><div id="wa-findings"></div></section>${report.target_objects.length ? `<section class="panel wa-objects"><div class="panel-head"><div><h2>${e(uiText("Gescanntes Inventar der Zieldatenbank"))}</h2><p class="small muted">${e(uiText("Objekte aus Zielscan #{0}. Detailansichten öffnen den jeweils aktuellen Scan.", report.target.snapshot_id))}</p></div></div><div class="panel-body"><input id="wa-object-query" type="search" placeholder="${e(uiText("Schema oder Objekt suchen …"))}" aria-label="${e(uiText("Zielobjekte durchsuchen"))}"></div><div id="wa-objects"></div></section>` : ""}<p class="wh-boundary">${e(report.limitations)}</p>` : ""}`;
}
function assessmentSourceStatus(source) {
  return `<p class="small muted">${source.snapshot_id ? `${e(uiText("Struktur-Scan"))} #${source.snapshot_id} · ${e(dt(source.scanned_at))}${source.stale ? ` · <span class="badge error">${e(uiText("Scan älter als 7 Tage"))}</span>` : ""}` : e(uiText("Noch kein erfolgreicher Scan"))}${source.job ? ` · ${e(uiText({ failed: "Letzter Scan fehlgeschlagen", queued: "Scan wartet", running: "Scan läuft", completed: "Scan abgeschlossen" }[source.job.status] || source.job.status))}` : ""}</p>`;
}
function assessmentInventory(report) {
  return `<section class="panel"><div class="panel-head"><h2>${e(uiText("Eingebundene Datenbanken auf diesem DWH-Server"))}</h2></div><div class="panel-body"><p class="small muted">${e(uiText("Nur Datenquellen mit gleichem Datenbanktyp, Host und Port, für die du Leserechte hast. Nicht eingebundene Datenbanken werden hier nicht automatisch entdeckt. Die Anzeige gilt für den jeweiligen Schema-Filter der Verbindung."))}</p></div><div class="table-wrap"><table><thead><tr><th>${e(uiText("Datenbank / Verbindung"))}</th><th>${e(uiText("Tabellen / Views"))}</th><th>${e(uiText("Spalten"))}</th><th>${e(uiText("Letzter Scan"))}</th><th></th></tr></thead><tbody>${report.server_databases.map((s) => `<tr><td><strong>${e(s.database)}</strong><p class="small muted">${e(s.name)} · ${e(s.schema_filter || uiText("Alle zugänglichen Schemas"))}${s.id === report.target?.id ? ` · ${e(uiText("Vergleichsziel"))}` : ""}</p></td><td>${s.table_count} / ${s.view_count}</td><td>${s.column_count}</td><td>${assessmentSourceStatus(s)}</td><td><div class="actions">${assessmentButton("Struktur öffnen", "source", s.id)}${s.can_scan ? assessmentButton("Scannen", "scan", s.id, "", ["queued", "running"].includes(s.job?.status)) : ""}</div></td></tr>`).join("") || `<tr><td colspan="5">${e(uiText("Noch keine passende DWH-Verbindung vorhanden."))}</td></tr>`}</tbody></table></div></section>`;
}
function assessmentSources(report) {
  return `<section class="panel"><div class="panel-head"><h2>${e(uiText("Strukturstand der Anwendungsquellen"))}</h2></div><div class="table-wrap"><table><thead><tr><th>${e(uiText("Datenquelle"))}</th><th>${e(uiText("Objekte / Spalten"))}</th><th>${e(uiText("Änderungen seit dem vorherigen Scan"))}</th><th></th></tr></thead><tbody>${report.sources.map((s) => `<tr><td><strong>${e(s.name)}</strong>${assessmentSourceStatus(s)}</td><td>${s.object_count} / ${s.column_count}</td><td>${s.changes ? e(uiText("{0} ergänzt · {1} entfernt · {2} verändert", s.changes.added_tables, s.changes.removed_tables, s.changes.changed_tables)) + `<p class="small muted">${e(uiText("Vergleich mit Scan #{0} vom {1}", s.changes.before_snapshot_id, dt(s.changes.before_created)))}</p>` : e(uiText("Noch kein vorheriger Scan zum Vergleichen"))}</td><td><div class="actions">${assessmentButton("Schema-Vergleich öffnen", "compare", s.id, "", !s.changes)}${s.can_scan ? assessmentButton("Scannen", "scan", s.id, "", ["queued", "running"].includes(s.job?.status)) : ""}</div></td></tr>`).join("") || `<tr><td colspan="4">${e(uiText("Noch keine Anwendungsquellen zugeordnet."))}</td></tr>`}</tbody></table></div></section>`;
}
function assessmentPaint() {
  const r = state.dwhAssessment;
  if (
    !r ||
    r.project_id !== state.dwhProject?.id ||
    !document.getElementById("wa-findings")
  )
    return;
  const level = document.getElementById("wa-severity").value;
  const entries = r.findings
    .map((f, i) => ({ ...f, index: i }))
    .filter((f) => level === "all" || f.severity === level);
  state.waFindingPage = Math.min(
    state.waFindingPage || 0,
    Math.max(0, Math.ceil(entries.length / 10) - 1),
  );
  const offset = state.waFindingPage * 10;
  document.getElementById("wa-findings").innerHTML = `<div class="panel-body">${
    entries
      .slice(offset, offset + 10)
      .map(
        (f) =>
          `<article class="wa-finding"><span class="badge ${f.severity === "warning" ? "error" : "neutral"}">${e(uiText(f.severity === "warning" ? "Struktur prüfen" : "Dokumentation prüfen"))}</span><p>${e(f.message)}</p><div class="actions">${f.action && (f.action !== "settings" || state.dwhProject.can_edit) ? assessmentButton({ settings: "Einstellungen öffnen", scan: "Scan prüfen", source: "Struktur öffnen", compare: "Schema-Vergleich öffnen", model: "Zielmodell öffnen", mapping: "Feldzuordnungen öffnen" }[f.action], "hint", f.index) : ""}${state.view === "warehouse-workspace" && state.dwhProject.can_edit ? assessmentButton("Als Aufgabe übernehmen", "task", f.index) : ""}</div></article>`,
      )
      .join("") ||
    `<p>${e(uiText("Keine Hinweise in dieser Auswahl. Dies ist keine Prüfung der Datenqualität."))}</p>`
  }${r.omitted_findings ? `<p>${e(uiText("{0} weitere Hinweise wurden wegen des Berichtslimits ausgelassen. Grenzen: 5.000 Hinweise je Prüfung.", r.omitted_findings))}</p>` : ""}</div>${assessmentPager("finding", state.waFindingPage, entries.length)}`;
  const container = document.getElementById("wa-objects");
  if (!container) return;
  const q = document
    .getElementById("wa-object-query")
    .value.trim()
    .toLocaleLowerCase(uiLocale);
  const objects = r.target_objects.filter((t) =>
    `${t.schema}.${t.name}`.toLocaleLowerCase(uiLocale).includes(q),
  );
  state.waObjectPage = Math.min(
    state.waObjectPage || 0,
    Math.max(0, Math.ceil(objects.length / 25) - 1),
  );
  container.innerHTML = `<div class="table-wrap"><table><thead><tr><th>${e(uiText("Objekt"))}</th><th>${e(uiText("Typ"))}</th><th>${e(uiText("Spalten"))}</th><th>${e(uiText("Im Plan"))}</th><th></th></tr></thead><tbody>${
    objects
      .slice(state.waObjectPage * 25, state.waObjectPage * 25 + 25)
      .map(
        (t) =>
          `<tr><td class="mono">${e([t.schema, t.name].filter(Boolean).join("."))}</td><td>${e(uiText(t.kind === "view" ? "View" : "Tabelle"))}</td><td>${t.column_count}</td><td>${e(uiText(t.planned ? "Ja" : "Nein"))}</td><td>${assessmentButton("Details öffnen", "object", r.target.id, `data-key="${e(t.key)}"`)}</td></tr>`,
      )
      .join("") ||
    `<tr><td colspan="5">${e(uiText("Keine passenden Zielobjekte."))}</td></tr>`
  }</tbody></table></div>${assessmentPager("object", state.waObjectPage, objects.length)}`;
}
function assessmentPager(kind, page, total) {
  const size = kind === "finding" ? 10 : 25;
  return `<div class="catalog-pagination"><span>${e(uiText("{0}–{1} von {2}", total ? page * size + 1 : 0, Math.min(total, page * size + size), total))}</span><div class="actions">${assessmentButton("Vorherige Seite", "page", kind, `data-direction="-1"`, page === 0)}${assessmentButton("Nächste Seite", "page", kind, `data-direction="1"`, (page + 1) * size >= total)}</div></div>`;
}
function renderAssessmentParent() {
  if (state.view === "warehouse-workspace") renderWarehouseWorkspace();
  else renderDwhProject();
  assessmentPaint();
}
async function assessmentLoad() {
  const p = state.dwhProject,
    view = state.view;
  await loadSources();
  const report = await api(`/api/dwh/projects/${p.id}/assessment`);
  if (state.dwhProject.id === p.id && state.view === view) {
    state.dwhAssessment = report;
    state.waFindingPage = 0;
    state.waObjectPage = 0;
    renderAssessmentParent();
  }
}
async function assessmentOpenSource(id, target = {}) {
  if (state.view === "warehouse-workspace") {
    state.dwhReturnProject = null;
    state.whReturn = {
      id: state.wh.id,
      name: state.dwhProject.name,
      phase: state.whTab,
    };
  } else {
    state.whReturn = null;
    state.dwhReturnProject = {
      id: state.dwhProject.id,
      name: state.dwhProject.name,
      step: state.dwhTab,
    };
  }
  await navigate("source", id, target);
}
async function warehouseAssessmentClick(button) {
  const action = button.dataset.action.slice(3),
    id = button.dataset.id,
    r = state.dwhAssessment;
  if (action === "load") {
    button.disabled = true;
    try {
      await assessmentLoad();
    } finally {
      button.disabled = false;
    }
  }
  if (action === "settings" && state.dwhProject.can_edit) dwhProjectModal(true);
  if (action === "catalog") await navigate("sources");
  if (
    action === "source" ||
    action === "er" ||
    action === "object" ||
    action === "compare"
  ) {
    await assessmentOpenSource(
      id,
      action === "er"
        ? { tab: "er" }
        : action === "object"
          ? { table: button.dataset.key }
          : {},
    );
    if (action === "compare") await changeSourceTab("compare");
  }
  if (action === "scan") {
    const s = [r.target, ...r.sources, ...r.server_databases].find(
      (s) => s?.id === Number(id),
    );
    if (
      !s?.can_scan ||
      !confirm(
        uiText(
          "Struktur von {0} jetzt scannen? Nach Abschluss den Bestand erneut prüfen.",
          s.name,
        ),
      )
    )
      return;
    button.disabled = true;
    try {
      await api(`/api/sources/${id}/scan`, "POST");
      await assessmentLoad();
      toast(uiText("Schema-Scan gestartet. Nach Abschluss Bestand prüfen."));
    } finally {
      button.disabled = false;
    }
  }
  if (action === "page") {
    state[id === "finding" ? "waFindingPage" : "waObjectPage"] += Number(
      button.dataset.direction,
    );
    assessmentPaint();
  }
  if (action === "hint") {
    const f = r.findings[Number(id)];
    if (f.action === "settings" && state.dwhProject.can_edit)
      dwhProjectModal(true);
    if (["source", "scan", "compare"].includes(f.action)) {
      await assessmentOpenSource(f.source_id);
      if (f.action === "compare") await changeSourceTab("compare");
    }
    if (["model", "mapping"].includes(f.action))
      await navigate("warehouse-project", state.dwhProject.id, {
        step: f.action === "mapping" ? "mappings" : "model",
        ...(f.table_id ? { table: f.table_id } : {}),
      });
  }
  if (action === "task") {
    const f = r.findings[Number(id)];
    whTaskModal();
    const form = document.getElementById("wh-task-form");
    form.elements.title.value = f.message.slice(0, 190);
    form.elements.kind.value =
      f.code.startsWith("mapped") || f.code.startsWith("target")
        ? "implementation"
        : "operations";
    form.elements.notes.value = uiText(
      "Strukturprüfung vom {0}, Projektversion {1}: {2}",
      dt(r.generated_at),
      r.project_version,
      f.message,
    ).slice(0, 4000);
  }
}
