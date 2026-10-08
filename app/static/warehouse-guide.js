"use strict";

function whConcept() {
  return `<section class="panel panel-body wh-concept"><h2>${e(uiText("Ein Warehouse – mehrere fachliche Teilprojekte"))}</h2><p>${e(uiText("Das zentrale Warehouse ist euer gemeinsames Zielsystem und dessen gemeinsamer Plan. Ein Teilprojekt beschreibt eine Auswertung, zum Beispiel Maschinendaten. Eine Abteilung kann mehrere Teilprojekte betreuen."))}</p><div class="wh-architecture" aria-label="${e(uiText("Von Anwendungsdaten zu Auswertungen"))}"><div><span class="eyebrow">${e(uiText("1 · Eure Anwendungen"))}</span><h3>${e(uiText("Datenquellen"))}</h3><p>${e(uiText("Maschinensteuerung · ERP · Wartung"))}</p><small>${e(uiText("Vorhandene Datenbanken einbinden und scannen"))}</small></div><span class="wh-flow-arrow" aria-hidden="true">→</span><div class="wh-architecture-center"><span class="eyebrow">${e(uiText("2 · Gemeinsames Ziel"))}</span><h3>${e(uiText("Zentrales Warehouse"))}</h3><p>${e(uiText("Gemeinsame Daten und Beziehungen"))}</p><small>${e(uiText("Einmal geplant: Datum, Maschine, Standort"))}</small></div><span class="wh-flow-arrow" aria-hidden="true">→</span><div><span class="eyebrow">${e(uiText("3 · Fachliche Nutzung"))}</span><h3>${e(uiText("Abteilungen & Teilprojekte"))}</h3><p>${e(uiText("Produktion → Maschinendaten"))}<br>${e(uiText("Instandhaltung → Wartungsanalyse"))}</p><small>${e(uiText("Beide verwenden dieselbe Maschinentabelle"))}</small></div></div><p class="small muted">${e(uiText("Die Pfeile beschreiben den geplanten Datenfluss. DatabaseDoc kopiert durch einen Scan oder eine Feldzuordnung noch keine Daten in ein Warehouse."))}</p></section>`;
}

function whBuildSteps(workspace = null) {
  const p = workspace?.project,
    areas = workspace?.areas || [],
    tasks = workspace?.tasks || [];
  const workflow = p ? dwhWorkflow(p, workspace.comparison) : [];
  const complete = (id) =>
    workflow.find((step) => step.id === id)?.complete || false;
  const sources =
    p?.source_ids.map((id) =>
      state.sources.find((source) => source.id === id),
    ) || [];
  const missingSource = sources.find((source) => !source?.snapshot_id);
  const emptyArea = areas.find((area) => !area.table_ids.length);
  const implementations = tasks.filter(
    (task) => task.kind === "implementation",
  );
  const quality = tasks.filter((task) => task.kind === "quality");
  const actions = (
    label,
    action,
    id = "",
    write = false,
    unavailable = false,
  ) => ({
    label,
    action,
    id,
    disabled:
      unavailable ||
      (write && !(p ? p.can_edit : state.user.role !== "viewer")),
  });
  const steps = [
    {
      id: "setup",
      title: "Warehouse einrichten",
      done: !!p?.goal.trim() && !!p.target_kind && !!p.target_schema,
      task: "Gib dem gemeinsamen Warehouse einen Namen und beschreibe das übergreifende Ziel. Wähle SQL Server, PostgreSQL oder MariaDB und das Zielschema beziehungsweise die Zieldatenbank.",
      tool: "Warehouse anlegen oder seine Einstellungen bearbeiten. Die Zielverbindung kannst du ergänzen, sobald die echte Zieldatenbank bereitsteht.",
      result:
        "Ein zentraler Warehouse-Plan. Das Anlegen dieses Plans erzeugt noch keine Datenbank auf einem Zielserver.",
      buttons: [
        actions(
          p ? "Warehouse-Einstellungen" : "Zentrales Warehouse anlegen",
          p ? "settings" : "begin",
          "",
          true,
        ),
      ],
    },
    {
      id: "subjects",
      title: "Teilprojekt und Abteilung festlegen",
      done:
        areas.length > 0 &&
        areas.every(
          (area) =>
            (area.goal || "").trim() &&
            (area.department || "").trim() &&
            (area.owner || "").trim(),
        ),
      task: "Beginne mit einer konkreten Frage: Wie lange stehen unsere Maschinen pro Tag still? Lege dafür das Teilprojekt Maschinendaten an, ordne es der Produktion zu und benenne einen Verantwortlichen.",
      tool: "Unter Teilprojekte ein Auswertungsziel, eine Abteilung und einen Verantwortlichen hinterlegen. Weitere Auswertungen werden weitere Teilprojekte im selben Warehouse.",
      result:
        "Ein fachlicher Auftrag mit Zuständigkeit. Abteilungen teilen sich das Warehouse; gemeinsame Tabellen werden nicht pro Abteilung kopiert.",
      detail: p
        ? uiText(
            "{0} von {1} Teilprojekten mit Ziel, Abteilung und Verantwortlichen",
            areas.filter(
              (area) =>
                (area.goal || "").trim() &&
                (area.department || "").trim() &&
                (area.owner || "").trim(),
            ).length,
            areas.length,
          )
        : "",
      buttons: [
        actions("Teilprojekte planen", "phase", "areas"),
        actions("Teilprojekt anlegen", "add-area", "", true),
      ],
    },
    {
      id: "sources",
      title: "Anwendungsdaten verstehen",
      done:
        sources.length > 0 && sources.every((source) => source?.snapshot_id),
      task: "Wähle die Anwendungsdatenbanken aus, die deine Auswertung benötigt. Prüfe Tabellen, Schlüssel, Zeitstempel und Einheiten; ein Tabellenname allein erklärt noch nicht die fachliche Bedeutung.",
      tool: "Quellen in den Warehouse-Einstellungen auswählen. Öffne jede Quelle und starte dort einen Schema-Scan. Die Dokumentation und das ER-Modell helfen beim Verständnis.",
      result:
        "Gescanntes Quellwissen für den Entwurf. Ein Scan dokumentiert die Struktur und übernimmt keine Datenwerte ins Warehouse.",
      detail: p
        ? uiText(
            "{0} von {1} ausgewählten Quellen gescannt",
            sources.filter((source) => source?.snapshot_id).length,
            sources.length,
          )
        : "",
      buttons: [
        actions("Datenquellen öffnen", "sources"),
        actions("Quellen auswählen", "settings", "", true),
        ...(sources.length
          ? [
              actions(
                "Quellstruktur ansehen",
                "input-source",
                (missingSource || sources[0])?.id,
                false,
                !(missingSource || sources[0])?.id,
              ),
            ]
          : []),
      ],
    },
    {
      id: "model",
      title: "Gemeinsames Zielmodell entwerfen",
      done: complete("model") && areas.length > 0 && !emptyArea,
      task: "Plane eine Faktentabelle für Messungen oder Ereignisse, zum Beispiel eine Zeile je Maschinenereignis mit Stillstandsminuten. Verknüpfe sie mit Dimensionen wie Maschine, Datum und Standort.",
      tool: "Ein Startmodell im Teilprojekt anlegen und anpassen oder Tabellen manuell planen. Quellstrukturen kannst du im Modelleditor als Staging-Entwurf übernehmen. Ordne zentrale Tabellen den passenden Teilprojekten zu.",
      result:
        "Ein gemeinsames Modell mit Tabellen, Schlüsseln, Beziehungen und einer klaren Bedeutung jeder Zeile. Staging hält die Quellstruktur; Fakten und Dimensionen bilden die fachliche Auswertung.",
      buttons: [
        ...(emptyArea
          ? [actions("Startmodell anlegen", "starter", emptyArea.id, true)]
          : []),
        actions("Zielmodell bearbeiten", "editor", "model"),
        actions("Gesamtmodell ansehen", "phase", "model"),
      ],
    },
    {
      id: "loading",
      title: "Datenherkunft und Ladeverfahren planen",
      done: complete("mappings"),
      task: "Lege fest, aus welchem Quellfeld jedes Zielfeld entsteht. Beschreibe Berechnungen, Einheiten, Aktualisierung, Historie und den Umgang mit Fehlern oder gelöschten Datensätzen.",
      tool: "Quellfelder oder Ableitungen an Zielspalten hinterlegen und die Ladestrategie jeder Tabelle beschreiben. ETL bedeutet: Daten aus den Anwendungen lesen, aufbereiten und ins Warehouse laden.",
      result:
        "Eine nachvollziehbare Spezifikation für Ladejobs. Feldzuordnungen und Ladestrategien sind Planung; sie führen noch keinen Ladejob aus.",
      buttons: [
        actions("Feldzuordnungen bearbeiten", "editor", "mappings"),
        actions("Datenherkunft prüfen", "phase", "lineage"),
      ],
    },
    {
      id: "implementation",
      title: "Warehouse im Zielsystem aufbauen",
      done:
        complete("progress") &&
        implementations.length > 0 &&
        implementations.every((task) => task.status === "done"),
      task: "Stelle die echte Zieldatenbank bereit. Prüfe den SQL-Entwurf und führe ihn im Zielsystem aus. Implementiere danach die Ladejobs, teste sie und richte ihre regelmäßige Ausführung ein.",
      tool: "SQL-Entwurf herunterladen, Tabellenstatus im Modelleditor pflegen und Umsetzungsschritte mit Ergebnissen unter Betreuung dokumentieren. Der SQL-Export erstellt Tabellenstrukturen; er enthält keine fertigen Ladejobs.",
      result:
        "Ein außerhalb von DatabaseDoc aufgebautes und befülltes Warehouse. Der angezeigte Stand folgt euren Angaben und bestätigt keine ausgeführten SQL-Befehle oder Ladejobs.",
      detail: p
        ? uiText(
            "{0} von {1} Tabellen als umgesetzt gemeldet · {2} von {3} Umsetzungsaufgaben mit Ergebnis dokumentiert",
            p.tables.filter((table) =>
              ["implemented", "accepted"].includes(table.status),
            ).length,
            p.tables.length,
            implementations.filter((task) => task.status === "done").length,
            implementations.length,
          )
        : "",
      buttons: [
        actions(
          "SQL-Entwurf",
          "sql",
          "",
          false,
          !p?.tables.length || p.tables.some((table) => !table.columns.length),
        ),
        actions("Tabellenstatus pflegen", "editor", "progress"),
        actions("Umsetzung dokumentieren", "phase", "operations"),
      ],
    },
    {
      id: "validation",
      title: "Ergebnis prüfen und Betrieb betreuen",
      done:
        complete("check") &&
        quality.length > 0 &&
        quality.every((task) => task.status === "done") &&
        tasks.some(
          (task) =>
            task.kind === "operations" &&
            (task.owner || "").trim() &&
            task.due_date,
        ),
      task: "Binde die echte Warehouse-Datenbank als Zieldatenquelle ein und scanne sie. Vergleiche ihre Struktur mit dem Plan. Prüfe zusätzlich Summen, Anzahlen, Vollständigkeit und Aktualität gegen die Anwendungen.",
      tool: "Zieldatenquelle in den Einstellungen verbinden, Zielabgleich öffnen und Prüfergebnisse unter Betreuung festhalten. Benenne dort Verantwortliche und Termine für den laufenden Betrieb.",
      result:
        "Dokumentierter Strukturabgleich und eigene Datenprüfungen. Ein passendes Schema allein beweist keine korrekten Daten. Prüftermine im Tool starten keine Jobs und versenden keine Erinnerungen.",
      detail: p
        ? uiText(
            "{0} von {1} Qualitätsprüfungen mit Ergebnis dokumentiert · {2} Betriebsaufgaben mit Verantwortlichen und Prüftermin",
            quality.filter((task) => task.status === "done").length,
            quality.length,
            tasks.filter(
              (task) =>
                task.kind === "operations" &&
                (task.owner || "").trim() &&
                task.due_date,
            ).length,
          )
        : "",
      buttons: [
        actions("Zielabgleich öffnen", "phase", "check"),
        actions("Betreuung öffnen", "phase", "operations"),
      ],
    },
  ];
  return [steps[0], steps[2], steps[1], ...steps.slice(3)];
}

function whGuideSelection(workspace) {
  const steps = whBuildSteps(workspace);
  const saved =
    state.whGuide?.warehouseId === workspace.id ? state.whGuide.step : "";
  return (
    steps.find((step) => step.id === saved) ||
    steps.find((step) => !step.done) ||
    steps.at(-1)
  );
}

function whGuideSelect(step) {
  if (!whBuildSteps(state.wh).some((item) => item.id === step)) return;
  state.whGuide = { warehouseId: state.wh.id, step };
  state.whTab = "overview";
  history.replaceState(
    null,
    "",
    `#warehouse-workspace/${state.wh.id}?phase=overview&step=${step}`,
  );
  renderWarehouseWorkspace();
  document.getElementById("wh-guide-title")?.focus();
}

function whGuidePlan() {
  const p = state.dwhProject;
  const sourceName = (id) =>
    state.sources.find((source) => source.id === id)?.name ||
    uiText("Quelle #{0}", id);
  const lines = [
    uiText("Umsetzungs- und Ladeplan"),
    p.name,
    `${dwhEngines[p.target_kind]} · ${p.target_schema}`,
    "",
    uiText(
      "Dieser Plan dokumentiert den Datenfluss. SQL und Ladejobs werden im Zielsystem ausgeführt.",
    ),
    "",
    uiText(
      "1. Zieldatenbank bereitstellen und den SQL-Entwurf prüfen und ausführen.",
    ),
    uiText(
      "2. Ladejob erstellen: Quellen lesen, Daten aufbereiten, zuerst Dimensionen und danach Fakten laden.",
    ),
    uiText(
      "3. Ladejob testen, Fehlerbehandlung und regelmäßige Ausführung einrichten.",
    ),
    uiText(
      "4. Summen und Zeilenanzahlen mit den Quellsystemen vergleichen; Ergebnisse dokumentieren.",
    ),
    "",
  ];
  for (const table of p.tables) {
    lines.push(
      `${p.target_schema}.${table.name}`,
      `${dwhRoles[table.role]} · ${table.grain || uiText("Zeilenbedeutung noch offen")}`,
    );
    lines.push(
      `${uiText("Ladestrategie & Historisierung")}: ${table.load_strategy || uiText("Noch offen")}`,
    );
    for (const c of table.columns) {
      const origin = c.identity
        ? uiText("Automatischer Schlüssel")
        : c.mapping
          ? `${sourceName(c.mapping.source_id)} / ${c.mapping.table_key}.${c.mapping.column_name} (${uiText("Scan")} #${c.mapping.snapshot_id})`
          : c.transformation
            ? uiText("Abgeleitet / manuell")
            : uiText("Quellfeld noch offen");
      lines.push(
        `  ${c.name} (${dwhTypes[c.data_type] || c.data_type}) ← ${origin}`,
      );
      if (c.transformation)
        lines.push(`    ${uiText("Ableitungsregel")}: ${c.transformation}`);
      if (c.description) lines.push(`    ${c.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function whGuideDetail(step, workspace) {
  const p = workspace.project;
  const workflow = dwhWorkflow(p, workspace.comparison);
  const current = workflow.find(
    (item) =>
      item.id ===
      {
        model: "model",
        loading: "mappings",
        implementation: "progress",
        validation: "check",
      }[step.id],
  );
  const example = {
    subjects: [
      "Beispiel: Umsatz auswerten",
      "Frage: Wie hoch ist der monatliche Nettoumsatz je Kunde? Teilprojekt: Vertrieb. Abteilung: Vertrieb. Verantwortlich: die Person, die die Zahlen fachlich prüft.",
    ],
    model: [
      "Beispiel: Welche Tabellen brauche ich?",
      "fact_sales: eine Zeile je Rechnungsposition, mit Nettobetrag. dim_customer: eine Zeile je Kunde. dim_date: eine Zeile je Datum. Die Faktentabelle verbindet Kunde und Datum über Schlüssel.",
    ],
    loading: [
      "Beispiel: Ein Feld zuordnen",
      "Öffne das Zielfeld net_amount. Wähle deine ERP-Quelle, die tatsächliche Rechnungstabelle und das passende Betragsfeld. Bei einer Berechnung beschreibst du die Regel, zum Beispiel Menge × Einzelpreis. Tabellen- und Feldnamen sind Beispiele.",
    ],
  }[step.id];
  let content = example
    ? `<aside class="wh-guide-example"><strong>${e(uiText(example[0]))}</strong><p>${e(uiText(example[1]))}</p></aside>`
    : "";
  if (step.id === "sources") {
    content += `<div class="wh-guide-source-list">${
      p.source_ids
        .map((id) => {
          const source = state.sources.find((source) => source.id === id);
          return `<div><span><strong>${e(source?.name || uiText("Quelle #{0}", id))}</strong><small>${e(uiText(source?.snapshot_id ? "Struktur gescannt" : "Schema-Scan fehlt"))}</small></span>${whButton("Struktur ansehen", "input-source", id)}</div>`;
        })
        .join("") ||
      `<p class="muted">${e(uiText("Wähle hier deine bereits eingebundenen Datenbanken aus."))}</p>`
    }</div>`;
  }
  if (step.id === "model" && workspace.areas.length) {
    content += `<p class="small muted">${e(uiText("Ein Startmodell enthält zunächst eine Faktentabelle und dim_date. Weitere Dimensionen, Felder und Beziehungen ergänzt du im Modelleditor."))}</p>`;
  }
  if (step.id === "implementation") {
    content += `<ol class="wh-guide-execution"><li><strong>${e(uiText("Tabellen erstellen"))}</strong><p>${e(uiText("Lade den SQL-Entwurf herunter. Prüfe ihn und führe ihn in deiner echten SQL-Server-, PostgreSQL- oder MariaDB-Zieldatenbank aus."))}</p></li><li><strong>${e(uiText("Quelldaten laden"))}</strong><p>${e(uiText("Ein separater Ladejob liest die Quelldaten, setzt deine Feldzuordnungen und Berechnungen um und schreibt sie in die Zieltabellen. Erstelle und betreibe diesen Job außerhalb des Tools. Der Ladeplan enthält die dafür gespeicherten Vorgaben."))}</p></li><li><strong>${e(uiText("Umsetzung festhalten"))}</strong><p>${e(uiText("Nach dem Test dokumentierst du den Tabellenstatus und das Ergebnis der Umsetzungsaufgaben. Ein SQL-Export allein befüllt keine Tabellen."))}</p></li></ol><p class="wh-boundary">${e(uiText("Aktuell erzeugt das Tool Tabellen-SQL und einen Ladeplan. Es führt keine SQL-Befehle oder Ladejobs auf deinen Servern aus."))}</p>`;
  }
  if (current) {
    const pending = current.checks.filter((check) => !check.done);
    content += `<details class="wh-guide-checks"><summary>${e(uiText("Was ist noch offen? ({0})", pending.length))}</summary><ul>${pending.map((check) => `<li>${e(check.label)}${check.work && p.can_edit && ["model", "loading"].includes(step.id) ? whGuideWorkButton(check.work) : ""}</li>`).join("") || `<li>${e(uiText("Die Angaben für diesen Schritt sind vollständig."))}</li>`}</ul></details>`;
  }
  if (["subjects", "model"].includes(step.id)) content += whDiscoveryView();
  return content;
}

function whBuildJourney(workspace) {
  const steps = whBuildSteps(workspace),
    active = whGuideSelection(workspace),
    index = steps.findIndex((step) => step.id === active.id),
    count = steps.filter((step) => step.done).length;
  const labels = [
    "Ziel festlegen",
    "Quellen auswählen",
    "Auswertung festlegen",
    "Tabellen modellieren",
    "Felder zuordnen",
    "Tabellen erstellen & Daten laden",
    "Ergebnis prüfen",
  ];
  const instructions = {
    setup:
      "Beschreibe das gemeinsame Ziel und wähle die Zielplattform. Deine Anwendungsdatenbanken bleiben die Quellen; das Warehouse bekommt eine eigene Zieldatenbank.",
    sources:
      "Wähle die bereits eingebundenen Datenbanken als Quellen dieses Warehouses. Öffne anschließend ihre Struktur. Wenn noch kein Scan vorhanden ist, starte dort einen Schema-Scan.",
    subjects:
      "Beginne mit einer einzigen Auswertung, zum Beispiel Umsatz je Kunde und Monat. Lege dafür ein Teilprojekt an und trage Abteilung und Verantwortliche ein.",
    model:
      "Entscheide zuerst, was eine Zeile in deiner Auswertung bedeutet. Plane dann die Zahlen in einer Faktentabelle und die beschreibenden Daten in Dimensionen. Beginne mit einem Startmodell und ergänze die benötigten Tabellen.",
    loading:
      "Ordne jedem Zielfeld ein Feld aus einer gescannten Datenquelle zu oder beschreibe eine Ableitung. Lege anschließend je Tabelle fest, wann und wie die Daten aktualisiert werden.",
    implementation:
      "Jetzt wird aus dem gespeicherten Plan eine echte Datenbank. Dafür brauchst du zwei getrennte Arbeitsschritte: die Tabellen erstellen und die Quelldaten über einen Ladejob einspielen.",
    validation:
      "Binde die echte Warehouse-Datenbank als Zieldatenquelle ein und scanne sie. Vergleiche die Struktur mit deinem Plan und prüfe die geladenen Zahlen gegen die Quellsysteme.",
  };
  let buttons = active.buttons;
  if (active.id === "sources")
    buttons = [
      {
        label: "Quellen auswählen",
        action: "guide-sources",
        disabled: !workspace.project.can_edit,
      },
    ];
  if (active.id === "subjects") {
    const missing = workspace.areas.find(
      (area) =>
        !area.goal?.trim() || !area.department?.trim() || !area.owner?.trim(),
    );
    buttons = [
      {
        label: missing
          ? "Teilprojekt vervollständigen"
          : workspace.areas.length
            ? "Teilprojekte ansehen"
            : "Erste Auswertung anlegen",
        action: missing
          ? "edit-area"
          : workspace.areas.length
            ? "phase"
            : "add-area",
        id: missing?.id || (workspace.areas.length ? "areas" : ""),
        disabled:
          !workspace.project.can_edit && (!workspace.areas.length || !!missing),
      },
    ];
  }
  if (active.id === "model" && !workspace.areas.length)
    buttons = [
      {
        label: "Zuerst eine Auswertung festlegen",
        action: "guide-step",
        id: "subjects",
      },
    ];
  if (active.id === "loading" && workspace.project.can_edit) {
    const missing = dwhWorkflow(workspace.project, workspace.comparison)
      .find((step) => step.id === "mappings")
      ?.checks.find((check) => !check.done && check.work);
    if (missing)
      buttons = [
        {
          label: missing.label,
          action: "guide-work",
          id: JSON.stringify(missing.work),
        },
        ...buttons,
      ];
  }
  if (active.id === "implementation")
    buttons = [
      active.buttons[0],
      {
        label: "Ladeplan herunterladen",
        action: "guide-plan",
        disabled: !workspace.project.tables.length,
      },
      ...active.buttons.slice(1),
    ];
  const main = buttons.find((button) => !button.disabled) || buttons[0];
  return `<section class="panel wh-build-guide" aria-label="${e(uiText("Warehouse Schritt für Schritt aufbauen"))}"><div class="panel-head"><div><h2>${e(uiText("Dein Weg von den Datenquellen zum Warehouse"))}</h2><p class="small muted">${e(uiText("Bearbeite einen Schritt nach dem anderen. Der Hauptbutton öffnet die passende Aktion."))}</p></div><span class="badge neutral">${e(uiText("{0} von {1} Schritten dokumentiert", count, steps.length))}</span></div><div class="wh-guide-layout"><nav class="wh-guide-nav" aria-label="${e(uiText("Aufbauschritte"))}">${steps.map((step, i) => `<button type="button" class="wh-guide-nav-step ${step.id === active.id ? "active" : ""}" data-action="wh-guide-step" data-id="${step.id}" ${step.id === active.id ? 'aria-current="step"' : ""}><span class="wh-step-number">${step.done ? icon("check") : i + 1}</span><span><strong>${e(uiText(labels[i]))}</strong><small>${e(uiText(step.done ? "Dokumentiert" : "Ausstehend"))}</small></span></button>`).join("")}</nav><article class="wh-guide-current" data-guide-step="${active.id}"><div class="eyebrow">${e(uiText("Schritt {0} von {1}", index + 1, steps.length))} · ${e(uiText(index < 5 ? "Im Tool planen" : "Im Zielsystem umsetzen und prüfen"))}</div><h2 id="wh-guide-title" tabindex="-1">${e(uiText(labels[index]))}</h2><p>${e(uiText(instructions[active.id]))}</p><div class="wh-guide-main-action">${main ? whButton(main.label, main.action, main.id || "", true, main.disabled) : ""}</div>${whGuideDetail(active, workspace)}${
    buttons.filter((button) => button !== main).length
      ? `<details class="wh-guide-other-actions"><summary>${e(uiText("Weitere Aktionen für diesen Schritt"))}</summary><div class="actions">${buttons
          .filter((button) => button !== main)
          .map((button) =>
            whButton(
              button.label,
              button.action,
              button.id || "",
              false,
              button.disabled,
            ),
          )
          .join("")}</div></details>`
      : ""
  }${active.detail ? `<p class="small muted">${e(active.detail)}</p>` : ""}<p class="wh-guide-result"><strong>${e(uiText("Am Ende dieses Schritts"))}</strong><br>${e(uiText(active.result))}</p><footer class="wh-guide-footer">${index ? whButton("Zurück", "guide-step", steps[index - 1].id) : "<span></span>"}${index + 1 < steps.length ? whButton("Nächsten Schritt ansehen", "guide-step", steps[index + 1].id) : whButton("Betreuung öffnen", "phase", "operations")}</footer><p class="small muted">${e(uiText("Weiterblättern speichert keinen Fortschritt. Der Status ergibt sich aus deinen gespeicherten Angaben und Prüfergebnissen."))}</p></article></div></section>`;
}

function whGuideSourcesModal() {
  const p = state.dwhProject;
  openModal(
    uiText("Quellen auswählen"),
    `<form id="wh-guide-sources-form" data-version="${p.version}"><p>${e(uiText("Wähle die Datenbanken, aus denen dieses Warehouse Daten erhalten soll. Bereits hinterlegte Verbindungen werden wiederverwendet."))}</p><div class="field"><label for="wh-guide-source-query">${e(uiText("Datenquellen suchen"))}</label><input id="wh-guide-source-query" type="search"></div><div class="wh-guide-source-picker">${state.sources
      .filter((source) => source.can_edit || p.source_ids.includes(source.id))
      .map(
        (source) =>
          `<label class="checkbox" data-source-name="${e(source.name.toLowerCase())}"><input type="checkbox" name="source_ids" value="${source.id}" ${p.source_ids.includes(source.id) ? "checked" : ""}><span><strong>${e(source.name)}</strong><small>${e(names[source.kind])} · ${e(uiText(source.snapshot_id ? "Struktur gescannt" : "Schema-Scan fehlt"))}</small></span></label>`,
      )
      .join(
        "",
      )}</div><p class="small muted">${e(uiText("Die Auswahl verbindet den Warehouse-Plan mit der Quelle. Sie kopiert keine Daten und verändert die Quelldatenbanken nicht."))}</p>${dwhFooter(uiText("Quellen speichern"))}</form>`,
  );
  document
    .getElementById("wh-guide-source-query")
    .addEventListener("input", (ev) => {
      const query = ev.target.value.trim().toLowerCase();
      for (const row of document.querySelectorAll(
        ".wh-guide-source-picker label",
      ))
        row.hidden = !row.dataset.sourceName.includes(query);
    });
}

function whDepartments() {
  const departments = new Map();
  for (const area of state.wh.areas) {
    const name = (area.department || "").trim();
    if (name && !departments.has(name.toLowerCase()))
      departments.set(name.toLowerCase(), name);
  }
  return [...departments].sort((a, b) => a[1].localeCompare(b[1], uiLocale));
}
function whDepartmentAreas() {
  const filter = state.whDepartmentFilter || "";
  return state.wh.areas.filter(
    (area) =>
      !filter ||
      (filter === "unset"
        ? !area.department?.trim()
        : `dept:${(area.department || "").trim().toLowerCase()}` === filter),
  );
}
function whDepartmentControl() {
  return `<div class="field"><label for="wh-department-filter">${e(uiText("Abteilung filtern"))}</label><select id="wh-department-filter"><option value="">${e(uiText("Alle Abteilungen"))}</option>${whDepartments()
    .map(
      ([key, name]) =>
        `<option value="${e("dept:" + key)}" ${state.whDepartmentFilter === "dept:" + key ? "selected" : ""}>${e(name)}</option>`,
    )
    .join(
      "",
    )}<option value="unset" ${state.whDepartmentFilter === "unset" ? "selected" : ""}>${e(uiText("Ohne Abteilungszuordnung"))}</option></select></div>`;
}

function whEditorContext(project) {
  return `<section class="panel panel-body wh-editor-context"><div class="eyebrow">${e(uiText(project.warehouse_id ? "Zentrales Warehouse · Modelleditor" : "Eigenständiger Entwurf"))}</div><p>${e(uiText(project.warehouse_id ? "Hier bearbeitest du das gemeinsame Zielmodell des Warehouses. Änderungen an einer gemeinsam genutzten Tabelle gelten für alle zugeordneten Teilprojekte und Abteilungen. Den Aufbau des gesamten Warehouses steuerst du im Fahrplan." : "Dieser Entwurf wird unabhängig von zentralen Warehouses gepflegt. Wenn er zu eurem gemeinsamen Warehouse gehören soll, verwende Als Warehouse verwenden in der Übersicht oder Projekt übernehmen in einem vorhandenen Warehouse."))}</p>${project.warehouse_id ? whButton("Zum Warehouse-Fahrplan", "return", project.warehouse_id) : `<button type="button" class="btn" data-action="nav" data-view="warehouse">${e(uiText("Warehouses & Entwürfe öffnen"))}</button>`}</section>`;
}

function whGuideWorkButton(work) {
  return whButton("Bearbeiten", "guide-work", JSON.stringify(work));
}

function whDiscoveryState() {
  const scope = JSON.stringify(
    state.sources.map((source) => [
      source.id,
      source.snapshot_id,
      source.can_edit,
    ]),
  );
  if (
    state.whDiscovery?.warehouseId !== state.wh.id ||
    state.whDiscovery?.userId !== state.user.id ||
    state.whDiscovery?.scope !== scope
  ) {
    state.whDiscovery = {
      warehouseId: state.wh.id,
      userId: state.user.id,
      scope,
      query: (state.wh.areas.find((area) => area.goal)?.goal || "").slice(
        0,
        200,
      ),
      data: null,
      busy: false,
      error: "",
      request: 0,
    };
  }
  return state.whDiscovery;
}

function whDiscoveryView() {
  const d = whDiscoveryState();
  return `<section class="wh-discovery" aria-labelledby="wh-discovery-title"><h3 id="wh-discovery-title">${e(uiText("Welche Auswertung brauchst du?"))}</h3><p class="small muted">${e(uiText("Zum Beispiel Kundenauswertung, Maschinenmessdaten oder Lagerbestand. Passende Tabellen werden über alle freigegebenen, gescannten Datenquellen gesucht."))}</p><form id="wh-discovery-form"><div class="field"><label for="wh-discovery-query">${e(uiText("Auswertung oder gesuchte Daten"))}</label><input id="wh-discovery-query" name="query" maxlength="200" minlength="2" required value="${e(d.query)}" placeholder="${e(uiText("Zum Beispiel: Kundenauswertung"))}"></div><button type="submit" class="btn">${e(uiText("Passende Tabellen finden"))}</button></form><p class="small muted">${e(uiText("Automatische Einordnung aus Namen, Feldern, Kommentaren, Beziehungen und Fachbegriffen. Es werden gespeicherte Metadaten gelesen. Vorschläge sind keine bestätigte fachliche Zuordnung."))}</p><div id="wh-discovery-results" aria-live="polite">${whDiscoveryResults()}</div></section>`;
}

function whDiscoveryResults() {
  const d = whDiscoveryState();
  if (d.busy)
    return `<p role="status">${e(uiText("Passende Tabellen werden gesucht …"))}</p>`;
  if (d.error) return `<p class="error-text" role="alert">${e(d.error)}</p>`;
  if (!d.data) return "";
  return `<p class="small">${e(uiText("{0} passende Tabellen", d.data.total))}${d.data.recognized_terms.length ? " · " + e(d.data.recognized_terms.join(", ")) : ""}</p>${d.data.unscanned_sources ? `<p class="hint">${e(uiText("{0} Quellen haben noch keinen Scan. Scanne sie unter Datenquellen, damit sie berücksichtigt werden können.", d.data.unscanned_sources))}</p>` : ""}<div class="wh-discovery-candidates">${d.data.candidates.map((c, i) => `<article><h4>${e(c.source_name)} · ${e([c.schema, c.table_name].filter(Boolean).join("."))}</h4><p class="small muted">${e(uiText("Datenbank: {0}", c.database_name))} · ${e(uiText("Scan"))} #${c.snapshot_id}</p><div class="tag-list">${(c.inferred_categories || c.matched_terms).map((label) => `<span class="tag">${e(label)}</span>`).join("")}${c.suggested_role ? `<span class="badge neutral">${e(uiText(c.suggested_role === "fact" ? "Mögliche Faktentabelle" : "Mögliche Dimension"))}</span>` : ""}</div><p class="small">${e(uiText("Hinweise im Objekt: {0}", c.matched_terms.join(", ") || uiText("Passende dokumentierte Namen oder Beschreibungen")))}</p>${c.related_tables.length ? `<p class="small muted">${e(uiText("Verknüpfte Tabellen: {0}", c.related_tables.join(", ")))}</p>` : ""}${c.concepts.length ? `<p class="small">${e(uiText("Bestätigte Fachbegriffe: {0}", c.concepts.join(", ")))}</p>` : ""}<div class="actions">${whButton("Struktur ansehen", "discovery-open", i)}${state.dwhProject.can_edit && state.sources.some((source) => source.id === c.source_id && source.can_edit) && state.wh.areas.length ? whButton("Für Auswertung übernehmen", "discovery-adopt", i) : ""}</div></article>`).join("") || `<p>${e(uiText("Keine passenden Tabellen gefunden. Probiere andere Begriffe oder ergänze Beschreibungen und Fachbegriffe in der Quelldokumentation."))}</p>`}</div><div class="wh-guide-footer">${whButton("Zurück", "discovery-page", d.data.page - 1, false, d.data.page <= 1)}<span class="small muted">${e(uiText("Seite {0} von {1}", d.data.page, Math.max(1, Math.ceil(d.data.total / d.data.page_size))))}</span>${whButton("Weitere Tabellen", "discovery-page", d.data.page + 1, false, d.data.page * d.data.page_size >= d.data.total)}</div>`;
}

function whDiscoveryPaint() {
  const node = document.getElementById("wh-discovery-results");
  if (node) node.innerHTML = whDiscoveryResults();
}

async function whDiscoverySearch(page = 1) {
  const d = whDiscoveryState(),
    input = document.getElementById("wh-discovery-query");
  if (input) d.query = input.value.trim();
  if (d.query.length < 2) {
    d.request++;
    d.data = null;
    d.busy = false;
    whDiscoveryPaint();
    return;
  }
  clearTimeout(state.whDiscoveryTimer);
  const request = ++d.request;
  d.busy = true;
  d.error = "";
  whDiscoveryPaint();
  try {
    const result = await api("/api/finder/candidates", "POST", {
      query: d.query,
      source_ids: [],
      page,
      page_size: 10,
    });
    if (state.whDiscovery !== d || d.request !== request) return;
    d.data = result;
  } catch (error) {
    if (state.whDiscovery !== d || d.request !== request) return;
    d.error = error.message;
  } finally {
    if (state.whDiscovery === d && d.request === request) {
      d.busy = false;
      whDiscoveryPaint();
    }
  }
}

function whDiscoveryInput() {
  const d = whDiscoveryState();
  d.userEdited = true;
  d.query = document.getElementById("wh-discovery-query").value;
  d.request++;
  d.data = null;
  d.busy = false;
  d.error = "";
  clearTimeout(state.whDiscoveryTimer);
  whDiscoveryPaint();
  state.whDiscoveryTimer = setTimeout(() => {
    if (
      state.whDiscovery === d &&
      document.getElementById("wh-discovery-query")
    )
      whDiscoverySearch();
  }, 600);
}

function whDiscoveryAuto() {
  const input = document.getElementById("wh-discovery-query");
  if (!input) return;
  const d = whDiscoveryState();
  if (!d.query && !d.userEdited) {
    d.query = (state.wh.areas.find((area) => area.goal)?.goal || "").slice(
      0,
      200,
    );
    input.value = d.query;
  }
  if (!d.data && !d.busy && !d.error && d.query.trim().length >= 2)
    whDiscoverySearch();
}

function whDiscoveryAdopt(index) {
  const candidate = whDiscoveryState().data?.candidates[index];
  if (!candidate || !state.dwhProject.can_edit) return;
  state.whDiscoveryCandidate = {
    ...structuredClone(candidate),
    warehouseId: state.wh.id,
    version: state.dwhProject.version,
  };
  openModal(
    uiText("Quelltabelle für die Auswertung übernehmen"),
    `<form id="wh-discovery-adopt-form"><p><strong>${e(candidate.source_name)} · ${e([candidate.schema, candidate.table_name].filter(Boolean).join("."))}</strong></p><p>${e(uiText("Die Struktur wird als Staging-Tabelle mit Quellzuordnungen in deinen Plan übernommen. Die Quelle wird bei Bedarf mit diesem Warehouse verbunden. Prüfe anschließend die Modellrolle, Datentypen und Beziehungen."))}</p>${dwhSelect(uiText("Teilprojekt"), "area_id", Object.fromEntries(state.wh.areas.map((area) => [area.id, area.name])), state.wh.areas[0]?.id)}<p class="wh-boundary">${e(uiText("Dies übernimmt den Strukturentwurf, keine Datenwerte. Das fertige Modell kann andere Tabellen und Felder benötigen als die Quelle."))}</p>${dwhFooter(uiText("Struktur in den Plan übernehmen"))}</form>`,
  );
}
