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
  return [
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
}

function whBuildJourney(workspace = null) {
  const steps = whBuildSteps(workspace),
    next = steps.find((step) => !step.done),
    count = steps.filter((step) => step.done).length;
  return `<section class="panel wh-build-guide"><div class="panel-head"><div><h2>${e(uiText("Von deinen Anwendungsdaten zum Warehouse"))}</h2><p class="small muted">${e(uiText("Jeder Schritt zeigt deine Aufgabe, die passende Stelle im Tool und das erwartete Ergebnis."))}</p></div>${workspace ? `<span class="badge neutral">${e(uiText("{0} von {1} Schritten dokumentiert", count, steps.length))}</span>` : ""}</div>${workspace ? `<div class="wh-guide-progress"><progress value="${count}" max="${steps.length}" aria-label="${e(uiText("Dokumentierter Aufbaufortschritt"))}"></progress><p class="small muted">${e(uiText("Der Fortschritt folgt gespeicherten Planungsangaben, Strukturvergleichen und manuell dokumentierten Aufgaben."))}</p></div>` : ""}${steps
    .map(
      (step, i) =>
        `<details class="wh-build-step" data-guide-step="${step.id}" ${next === step ? "open" : ""}><summary><span class="wh-step-number">${i + 1}</span><strong>${e(uiText(step.title))}</strong>${workspace ? `<span class="badge ${step.done ? "" : "neutral"}">${e(uiText(step.done ? "Dokumentiert" : "Ausstehend"))}</span>` : ""}</summary><div class="wh-step-body"><p><strong>${e(uiText("Deine Aufgabe"))}:</strong> ${e(uiText(step.task))}</p><p><strong>${e(uiText("Im Tool"))}:</strong> ${e(uiText(step.tool))}</p><p class="wh-step-result"><strong>${e(uiText("Erwartetes Ergebnis"))}:</strong> ${e(uiText(step.result))}</p>${step.detail ? `<p class="small muted">${e(step.detail)}</p>` : ""}<div class="actions">${step.buttons
          .filter(
            (button) =>
              workspace || ["begin", "sources"].includes(button.action),
          )
          .map((button) =>
            whButton(
              button.label,
              button.action,
              button.id,
              false,
              button.disabled,
            ),
          )
          .join(
            "",
          )}</div>${!workspace && !["setup", "sources"].includes(step.id) ? `<p class="small muted">${e(uiText("Diese Aktionen stehen nach dem Anlegen oder Öffnen eines Warehouses im Fahrplan bereit."))}</p>` : ""}</div></details>`,
    )
    .join("")}</section>`;
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
