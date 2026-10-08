"use strict";
const state = {
  user: null,
  csrf: "",
  sources: [],
  source: null,
  snapshot: null,
  dwhProjects: [],
  dwhProject: null,
  dwhTab: "overview",
  dwhTableId: null,
  dwhComparison: null,
  view: "sources",
  tab: "overview",
  table: 0,
  tableTab: "columns",
  query: "",
  filter: "all",
  statusFilter: "all",
  hostFilter: "all",
  tagFilter: "all",
  tagCategoryFilter: "all",
  catalogTags: [],
  schedule: null,
  comparison: null,
  compareBefore: null,
  compareAfter: null,
  searchQuery: "",
  searchSource: "all",
  searchKind: "all",
  searchPage: 1,
  searchResults: null,
  highlightColumn: null,
  sourceSort: "name",
  sourceSortDirection: "asc",
  sourcePage: 1,
  sourcePageSize: 25,
  catalogView: "table",
  history: [],
  users: [],
  audit: [],
  erPositions: {},
  erZoom: 1,
  erPan: { x: 0, y: 0 },
};
const root = document.getElementById("app"),
  modal = document.getElementById("modal");
const names = {
  mssql: "Microsoft SQL Server",
  mysql: "MySQL",
  mariadb: "MariaDB",
  postgresql: "PostgreSQL",
  mongodb: "MongoDB",
  sqlite: "SQLite",
};
const roles = {
  admin: "Administrator",
  editor: uiText("Bearbeiter"),
  viewer: uiText("Leser"),
};
const paths = {
  database:
    '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  users:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5"/>',
  shield:
    '<path d="M12 3 3 7v5c0 6 9 10 9 10s9-4 9-10V7z"/><path d="m8 12 3 3 5-6"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  server:
    '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 7.5h.1M7 17.5h.1M12 7.5h5M12 17.5h5"/>',
  table:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 9v12"/>',
  columns:
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  relations:
    '<rect x="2" y="3" width="6" height="7" rx="1"/><rect x="16" y="14" width="6" height="7" rx="1"/><path d="M5 10v7h11m-3-3 3 3-3 3"/>',
  refresh: '<path d="M20 7a9 9 0 1 0 1 7M20 2v5h-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>',
  edit: '<path d="m16 3 5 5-13 13H3v-5zM13 6l5 5"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h8"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12"/><circle cx="12" cy="12" r="3"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 2 2 3-2 3 2 2 3 1 1 3h6l1-3 3-1 2-2-2-3 2-3-2-2-3-1-1-3z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
};
function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.database}</svg>`;
}
function databaseLogo(kind) {
  return Object.hasOwn(names, kind)
    ? `<img class="database-logo" src="/static/database-logos/${kind}.svg" alt="" width="32" height="32">`
    : icon("database");
}
function e(v) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function dt(v) {
  return v
    ? new Date(v.endsWith("Z") ? v : v + "Z").toLocaleString(uiLocale, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : uiText("Noch kein Scan");
}
function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = uiMessage(message);
  node.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove("visible"), 4500);
}
async function api(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type":
        body instanceof File ? "application/octet-stream" : "application/json",
      "X-CSRF-Token": state.csrf,
    },
    body:
      body instanceof File
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.user) {
      finderReset();
      state.user = null;
      await showLogin();
    }
    throw new Error(
      typeof result.detail === "string"
        ? uiMessage(result.detail)
        : Array.isArray(result.detail)
          ? uiText("Bitte die Eingaben prüfen.")
          : localize`Anfrage fehlgeschlagen (${res.status}).`,
    );
  }
  return result;
}
function brand() {
  return `<div class="brand-block">${state.branding?.logo_url ? `<div class="company-brand"><img class="company-logo" src="${e(state.branding.logo_url)}" alt="${e(uiText("Firmenlogo"))}"></div>` : ""}<div class="brand">${icon("database")}<div><span class="application-name">${e(applicationName())}</span><small>DATABASE DOCUMENTATION</small></div></div></div>`;
}
async function showLogin() {
  if (UI_PROFILE_LANGUAGE !== "auto") {
    location.reload();
    return;
  }
  diagramCleanup();
  await loadBranding();
  const options = await api("/api/auth/options");
  root.innerHTML = localize`<div class="login-shell"><aside class="login-art">${brand()}<div><div class="eyebrow" style="color:#b5d7a2">Wissen, wie Daten zusammenhängen</div><h1>Deine Datenbanken.<br>Ein klarer Überblick.</h1><p>Strukturen entdecken, Beziehungen verstehen und Datenwissen gemeinsam festhalten.</p><svg class="art-nodes" viewBox="0 0 440 200" aria-hidden="true"><g fill="none" stroke="#739b7c"><path d="M130 60H200V150H275M130 60H310V40"/></g><g fill="#244d40" stroke="#739b7c"><rect x="0" y="18" width="130" height="90" rx="8"/><rect x="275" y="110" width="140" height="85" rx="8"/><rect x="280" y="5" width="140" height="75" rx="8"/></g><g fill="#c0e8aa" font-size="12" font-family="monospace"><text x="15" y="42">customers</text><text x="295" y="28">addresses</text><text x="290" y="134">orders</text></g><g stroke="#6f9779"><path d="M15 58h90M15 73h65M15 88h78M295 43h100M295 58h70M290 150h100M290 166h65M290 181h80"/></g></svg></div><small>Metadaten · ER-Modelle · Dokumentation</small></aside><main class="login-main"><div class="login-box"><div class="eyebrow">${e(uiText("Willkommen bei {0}", applicationName()))}</div><h2>Anmelden</h2><p>Öffne deine Datenbankdokumentation.</p><form id="login-form" class="login-form"><div class="field"><label for="login-user">Benutzername</label><input id="login-user" name="username" autocomplete="username" required autofocus></div><div class="field"><label for="login-pass">Passwort</label><input id="login-pass" name="password" type="password" autocomplete="current-password" required></div>${options.ad ? localize('<div class="field"><label for="provider">Anmeldung</label><select id="provider" name="provider"><option value="local">Lokales Konto</option><option value="ad">Microsoft Active Directory</option></select></div>') : ""}<button class="btn primary" type="submit">Anmelden ${icon("arrow")}</button><div class="error-text" id="login-error" role="alert">${location.search.includes("auth_error") ? uiText("Entra-Anmeldung fehlgeschlagen. Bitte Einrichtung oder Kontostatus prüfen.") : ""}</div></form>${options.entra ? localize('<div class="divider">oder</div><a class="btn" style="width:100%" href="/auth/entra">Mit Microsoft Entra ID anmelden</a>') : ""}<p class="login-foot">Der Zugriff richtet sich nach den Freigaben deines Administrators.</p></div></main></div>`;
}
function shell(content) {
  diagramCleanup();
  root.innerHTML = localize`<div class="layout"><aside class="sidebar">${brand()}<nav><div class="nav-label">Arbeitsbereich</div><button class="nav-button ${["sources", "source"].includes(state.view) ? "active" : ""}" data-action="nav" data-view="sources">${icon("database")}<span>Datenquellen</span></button>${localize`<button class="nav-button ${state.view === "search" ? "active" : ""}" data-action="nav" data-view="search">${icon("search")}<span>Globale Suche</span></button>`}<button class="nav-button ${state.view === "analysis" ? "active" : ""}" data-action="nav" data-view="analysis">${icon("grid")}<span>Analyse & Fachbegriffe</span></button><button class="nav-button ${["warehouse", "warehouse-project", "warehouse-workspace"].includes(state.view) ? "active" : ""}" data-action="nav" data-view="warehouse" title="Data Warehouse">${icon("relations")}<span>Data Warehouse</span></button><button class="nav-button ${["tools", "tool-design"].includes(state.view) ? "active" : ""}" data-action="nav" data-view="tools">${icon("edit")}<span>Tools</span></button>${state.user.role === "admin" ? localize`<div class="nav-label" style="margin-top:30px">Administration</div><button class="nav-button ${state.view === "users" ? "active" : ""}" data-action="nav" data-view="users">${icon("users")}<span>Benutzer & Rechte</span></button><button class="nav-button ${state.view === "audit" ? "active" : ""}" data-action="nav" data-view="audit">${icon("shield")}<span>Aktivitätsprotokoll</span></button><button class="nav-button ${state.view === "settings" ? "active" : ""}" data-action="nav" data-view="settings" title="Systemeinstellungen">${icon("settings")}<span>Systemeinstellungen</span></button>` : ""}</nav><div class="sidebar-bottom"><button class="profile-link ${state.view === "profile" ? "active" : ""}" data-action="nav" data-view="profile">${icon("settings")} ${e(uiText("Profileinstellungen"))}</button><div class="user-line"><div class="avatar">${e(state.user.display_name.slice(0, 1).toUpperCase())}</div><div><div class="small">${e(state.user.display_name)}</div><div style="font-size:10px;color:#a7c0b3">${roles[state.user.role]}</div></div></div>${state.user.provider === "local" ? localize('<button data-action="password">Passwort ändern</button>') : ""}<button data-action="logout">Abmelden</button></div></aside><main class="main"><header class="topbar"><div class="breadcrumb">${state.view === "settings" ? uiText("Administration") : uiText("Arbeitsbereich")} <span>/</span> <strong>${state.view === "profile" ? uiText("Profileinstellungen") : state.view === "analysis" ? uiText("Analyse & Fachbegriffe") : ["tools", "tool-design"].includes(state.view) ? "Tools" : state.view === "source" ? e(state.source.name) : state.view === "search" ? uiText("Globale Suche") : ["warehouse", "warehouse-project", "warehouse-workspace"].includes(state.view) ? uiText("Data Warehouse") : state.view === "users" ? uiText("Benutzer & Rechte") : state.view === "audit" ? uiText("Aktivitätsprotokoll") : state.view === "settings" ? uiText("Systemeinstellungen") : uiText("Datenquellen")}</strong></div><button class="btn ghost profile-mobile" data-action="nav" data-view="profile" title="Profileinstellungen">${icon("settings")}<span>Mein Profil</span></button><div class="env-pill"><span class="dot"></span> ${roles[state.user.role]}</div><button class="btn ghost mobile-logout" data-action="logout" style="display:none">Abmelden</button></header><div class="content">${content}</div></main></div>`;
  setupPlannedDiagrams();
}
function status(source) {
  const job = source.job;
  if (job?.status === "failed")
    return localize('<span class="badge error">Scan fehlgeschlagen</span>');
  if (["queued", "running"].includes(job?.status))
    return localize(
      '<span class="badge busy"><span class="dot" style="background:#b79043"></span> Scan läuft</span>',
    );
  if (source.snapshot_id)
    return localize(
      '<span class="badge"><span class="dot"></span> Dokumentiert</span>',
    );
  return localize('<span class="badge neutral">Bereit zum Scan</span>');
}
function stat(label, value, ic, bottom) {
  return `<div class="stat"><div class="stat-top">${label}${icon(ic)}</div><strong>${value.toLocaleString(uiLocale)}</strong><span class="bottom">${bottom}</span></div>`;
}
function sourceStats(sources) {
  return `<div class="stats">${stat(uiText("Datenquellen"), sources.length, "database", uiText("Verbundene Datenbanken"))}${stat(
    uiText("Tabellen & Collections"),
    sources.reduce((n, s) => n + s.table_count, 0),
    "table",
    uiText("In der Dokumentation"),
  )}${stat(
    uiText("Spalten & Felder"),
    sources.reduce((n, s) => n + s.column_count, 0),
    "columns",
    uiText("Dokumentierte Attribute"),
  )}${stat(
    uiText("Beziehungen"),
    sources.reduce((n, s) => n + s.relation_count, 0),
    "relations",
    uiText("Erkannte Fremdschlüssel"),
  )}</div>`;
}
function card(s) {
  return localize`<article class="source-card"><div class="source-card-top"><div class="db-icon ${s.kind}">${databaseLogo(s.kind)}</div><div style="flex:1;min-width:0"><button class="source-title" data-action="open" data-id="${s.id}">${e(s.name)}</button><div class="small muted">${names[s.kind]}</div></div>${status(s)}</div><div class="source-meta">${icon("server")}<span>${e(s.kind === "sqlite" ? s.config.path : s.config.host + (s.config.port ? ":" + s.config.port : "") + " / " + s.config.database)}</span></div><div class="tag-list card-classification">${sortedTags(
    s.tags,
  )
    .map((t) => tagBadge(t, s, true))
    .join(
      "",
    )}</div><div class="card-stats"><div><strong>${s.table_count}</strong><span>Objekte</span></div><div><strong>${s.column_count}</strong><span>Spalten</span></div><div><strong>${s.relation_count}</strong><span>Beziehungen</span></div></div><div class="card-footer"><span>${e(dt(s.scanned_at))}</span><button data-action="open" data-id="${s.id}">Öffnen ${icon("arrow")}</button></div></article>`;
}
const sourceSortLabels = {
  name: "Name",
  kind: uiText("Datenbanksystem"),
  host: "Server",
  table_count: uiText("Objekte"),
  status: "Status",
  scanned_at: uiText("Letzter Scan"),
};
const sourceStatusLabels = {
  documented: uiText("Dokumentiert"),
  unscanned: uiText("Ohne Scan"),
  running: uiText("Scan läuft"),
  failed: uiText("Scan fehlgeschlagen"),
};
const sourceCollator = new Intl.Collator(uiLanguage, {
  numeric: true,
  sensitivity: "base",
});
function sourceStatus(s) {
  if (s.job?.status === "failed") return "failed";
  if (["queued", "running"].includes(s.job?.status)) return "running";
  return s.snapshot_id ? "documented" : "unscanned";
}
function sourceHost(s) {
  return s.kind === "sqlite"
    ? uiText("SQLite-Dateien")
    : s.config.host || uiText("Unbekannter Server");
}
function filteredSources() {
  const terms = state.query
    .trim()
    .toLocaleLowerCase(uiLanguage)
    .split(/\s+/)
    .filter(Boolean);
  const list = state.sources.filter((s) => {
    const searchable = [
      s.name,
      names[s.kind],
      s.config.host,
      s.config.port,
      s.config.database,
      s.config.schema,
      s.config.path,
      ...(s.tags || []),
      s.owner,
      s.owner_email,
    ]
      .filter((v) => v !== undefined && v !== null)
      .join(" ")
      .toLocaleLowerCase(uiLanguage);
    return (
      (state.filter === "all" || state.filter === s.kind) &&
      (state.statusFilter === "all" ||
        state.statusFilter === sourceStatus(s)) &&
      (state.hostFilter === "all" || state.hostFilter === sourceHost(s)) &&
      (state.tagFilter === "all" || (s.tags || []).includes(state.tagFilter)) &&
      (state.tagCategoryFilter === "all" ||
        (s.tags || []).some(
          (tag) => tagStyle(tag, s).category === state.tagCategoryFilter,
        )) &&
      terms.every((term) => searchable.includes(term))
    );
  });
  const sortValue = (s) => {
    switch (state.sourceSort) {
      case "kind":
        return names[s.kind];
      case "host":
        return sourceHost(s);
      case "table_count":
        return s.table_count;
      case "status":
        return sourceStatusLabels[sourceStatus(s)];
      case "scanned_at":
        return s.scanned_at
          ? Date.parse(
              s.scanned_at.endsWith("Z") ? s.scanned_at : s.scanned_at + "Z",
            )
          : 0;
      default:
        return s.name;
    }
  };
  return list.sort((a, b) => {
    const av = sortValue(a),
      bv = sortValue(b);
    const comparison =
      typeof av === "number" ? av - bv : sourceCollator.compare(av, bv);
    return (
      (state.sourceSortDirection === "desc" ? -comparison : comparison) ||
      sourceCollator.compare(a.name, b.name) ||
      a.id - b.id
    );
  });
}
function sortHeader(key, label, extraClass = "") {
  const selected = state.sourceSort === key;
  return `<th class="${extraClass}" aria-sort="${selected ? (state.sourceSortDirection === "asc" ? "ascending" : "descending") : "none"}"><button data-action="source-sort" data-sort="${key}">${label}<span class="sort-mark" aria-hidden="true">${selected ? (state.sourceSortDirection === "asc" ? "↑" : "↓") : "↕"}</span></button></th>`;
}
function sourceRow(s) {
  const target = s.kind === "sqlite" ? s.config.path : s.config.database;
  return localize`<tr data-source-id="${s.id}">
    <td class="source-name-cell"><div class="source-name-wrap"><div class="db-icon ${s.kind}">${databaseLogo(s.kind)}</div><div><button class="source-title" data-action="open" data-id="${s.id}">${e(s.name)}</button><div class="catalog-owner">${e(s.owner || "")}</div><div class="tag-list">${sortedTags(
      s.tags,
    )
      .slice(0, 3)
      .map((tag) => tagBadge(tag, s, true))
      .join(
        "",
      )}${(s.tags || []).length > 3 ? `<button type="button" class="tag" data-action="ct-show" data-id="${s.id}">+${s.tags.length - 3}</button>` : ""}</div></div></div></td>
    <td class="engine-cell">${e(names[s.kind])}</td>
    <td class="source-target-cell"><span class="source-host" title="${e(sourceHost(s))}">${e(sourceHost(s))}${s.config.port && s.kind !== "sqlite" ? ":" + e(s.config.port) : ""}</span><span class="source-database" title="${e(target)}">${e(target || "—")}${s.config.schema ? " · " + e(s.config.schema) : ""}</span></td>
    <td class="numeric">${s.snapshot_id ? s.table_count.toLocaleString(uiLocale) : "—"}</td>
    <td class="source-status-cell">${status(s)}</td>
    <td class="source-scan-cell">${e(dt(s.scanned_at))}</td>
    <td class="source-open-cell"><button class="btn ghost" data-action="open" data-id="${s.id}" aria-label="${e(s.name)} öffnen">${icon("arrow")}</button></td>
  </tr>`;
}
function sourceEmpty() {
  return `<div class="empty">${icon("database")}<h2>${state.sources.length ? uiText("Keine passenden Quellen") : uiText("Deine erste Datenquelle")}</h2><p>${state.sources.length ? uiText("Passe die Suche oder Filter an, um weitere Datenbanken zu sehen.") : state.user.role === "admin" ? uiText("Hinterlege eine Datenbankverbindung und starte einen Scan. DatabaseDoc erstellt daraus die Dokumentation.") : uiText("Hier erscheinen Datenbanken, die für dich freigegeben wurden.")}</p>${state.sources.length ? localize('<button class="btn" data-action="reset-source-filters">Filter zurücksetzen</button>') : state.user.role === "admin" ? localize`<button class="btn primary" data-action="add-source">${icon("plus")} Datenquelle hinzufügen</button>` : ""}</div>`;
}
function paintSources() {
  const list = filteredSources();
  const pageCount = Math.max(1, Math.ceil(list.length / state.sourcePageSize));
  state.sourcePage = Math.max(1, Math.min(state.sourcePage, pageCount));
  const start = (state.sourcePage - 1) * state.sourcePageSize;
  const shown = list.slice(start, start + state.sourcePageSize);
  const catalog = document.getElementById("source-results");
  if (!catalog) return;
  catalog.innerHTML = !list.length
    ? sourceEmpty()
    : state.catalogView === "cards"
      ? `<div class="source-grid catalog-cards">${shown.map(card).join("")}</div>`
      : localize`<div class="table-wrap source-list-scroll"><table class="source-list" aria-label="Datenquellen"><thead><tr>${sortHeader("name", uiText("Datenquelle"))}${sortHeader("kind", uiText("System"))}${sortHeader("host", uiText("Server / Datenbank"))}${sortHeader("table_count", uiText("Objekte"), "numeric")}${sortHeader("status", "Status")}${sortHeader("scanned_at", uiText("Letzter Scan"))}<th><span class="sr-only">Öffnen</span></th></tr></thead><tbody>${shown.map(sourceRow).join("")}</tbody></table></div>`;
  document.getElementById("source-count").textContent =
    list.length === state.sources.length
      ? localize`${list.length} Datenquellen`
      : localize`${list.length} von ${state.sources.length} Datenquellen`;
  document.getElementById("source-range").textContent = list.length
    ? localize`${start + 1}–${Math.min(start + state.sourcePageSize, list.length)} von ${list.length}`
    : uiText("0 Ergebnisse");
  document.getElementById("source-pages").innerHTML =
    localize`<button class="btn" data-action="source-page" data-page="${state.sourcePage - 1}" ${state.sourcePage === 1 ? "disabled" : ""} aria-label="Vorherige Seite">${icon("back")}</button><span>Seite ${state.sourcePage} von ${pageCount}</span><button class="btn" data-action="source-page" data-page="${state.sourcePage + 1}" ${state.sourcePage === pageCount ? "disabled" : ""} aria-label="Nächste Seite">${icon("arrow")}</button>`;
  document.querySelectorAll('[data-action="source-kind"]').forEach((button) => {
    const selected = button.dataset.kind === state.filter;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  document
    .querySelectorAll('[data-action="catalog-view"]')
    .forEach((button) => {
      const selected = button.dataset.view === state.catalogView;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  const direction = document.getElementById("source-sort-direction");
  direction.innerHTML = state.sourceSortDirection === "asc" ? "↑" : "↓";
  direction.setAttribute(
    "aria-label",
    state.sourceSortDirection === "asc"
      ? uiText("Absteigend sortieren")
      : uiText("Aufsteigend sortieren"),
  );
  document.getElementById("source-sort").value = state.sourceSort;
  document.getElementById("source-page-size").value = String(
    state.sourcePageSize,
  );
  document.getElementById("reset-source-filters").hidden =
    !state.query &&
    state.filter === "all" &&
    state.statusFilter === "all" &&
    state.hostFilter === "all" &&
    state.tagFilter === "all" &&
    state.tagCategoryFilter === "all";
}
function resetSourceFilters() {
  state.query = "";
  state.filter = "all";
  state.statusFilter = "all";
  state.hostFilter = "all";
  state.tagFilter = "all";
  state.tagCategoryFilter = "all";
  state.sourcePage = 1;
  document.getElementById("source-search").value = "";
  document.getElementById("source-status-filter").value = "all";
  document.getElementById("source-host-filter").value = "all";
  document.getElementById("source-tag-filter").value = "all";
  document.getElementById("source-category-filter").value = "all";
  paintSources();
}
function renderSources() {
  const hosts = [...new Set(state.sources.map(sourceHost))].sort(
    sourceCollator.compare,
  );
  const tags = sortedTags([
    ...new Set(state.sources.flatMap((s) => s.tags || [])),
  ]);
  shell(localize`<div class="catalog-dashboard">
    <div class="page-head"><div><div class="eyebrow">Datenkatalog</div><h1>Datenquellen</h1><p>Datenbanken finden, Schema-Stände prüfen und Dokumentationen öffnen.</p></div>${classificationActions()}</div>
    ${sourceStats(state.sources)}
    <div class="engine-filters" role="group" aria-label="Nach Datenbanksystem filtern"><button class="engine-filter" data-action="source-kind" data-kind="all">Alle Systeme <span>${state.sources.length}</span></button>${Object.entries(
      names,
    )
      .map(
        ([kind, label]) =>
          `<button class="engine-filter" data-action="source-kind" data-kind="${kind}">${databaseLogo(kind)}${label}<span>${state.sources.filter((s) => s.kind === kind).length}</span></button>`,
      )
      .join("")}</div>
    <section class="panel catalog-panel">
      <div class="catalog-toolbar"><div class="search">${icon("search")}<input id="source-search" aria-label="Datenquellen durchsuchen" placeholder="Name, Server, Tag oder Verantwortliche suchen …" value="${e(state.query)}"></div><select id="source-host-filter" aria-label="Nach Server filtern"><option value="all">Alle Server</option>${hosts.map((host) => `<option value="${e(host)}" ${state.hostFilter === host ? "selected" : ""}>${e(host)}</option>`).join("")}</select><select id="source-tag-filter" aria-label="Nach Tag filtern"><option value="all">Alle Tags</option>${tags.map((tag) => `<option value="${e(tag)}" ${state.tagFilter === tag ? "selected" : ""}>${e(tag)}</option>`).join("")}</select>${classificationFilter()}<select id="source-status-filter" aria-label="Nach Scan-Status filtern"><option value="all">Alle Status</option>${Object.entries(
        sourceStatusLabels,
      )
        .map(
          ([key, label]) =>
            `<option value="${key}" ${state.statusFilter === key ? "selected" : ""}>${label}</option>`,
        )
        .join("")}</select></div>
      <div class="catalog-controls"><div class="catalog-count"><span id="source-count" aria-live="polite"></span><button class="text-button" id="reset-source-filters" data-action="reset-source-filters">Filter zurücksetzen</button></div><div class="catalog-display-controls"><label class="sr-only" for="source-sort">Datenquellen sortieren</label><select id="source-sort">${Object.entries(
        sourceSortLabels,
      )
        .map(([key, label]) => `<option value="${key}">${label}</option>`)
        .join(
          "",
        )}</select><button class="btn" id="source-sort-direction" data-action="source-sort-direction"></button><div class="view-switch" role="group" aria-label="Darstellung"><button data-action="catalog-view" data-view="table" aria-label="Listenansicht" title="Listenansicht">${icon("table")}</button><button data-action="catalog-view" data-view="cards" aria-label="Kartenansicht" title="Kartenansicht">${icon("grid")}</button></div></div></div>
      <div id="source-results"></div>
      <div class="catalog-pagination"><div class="page-size"><label for="source-page-size">Pro Seite</label><select id="source-page-size"><option value="25">25</option><option value="50">50</option><option value="100">100</option></select><span id="source-range" aria-live="polite"></span></div><div id="source-pages" class="page-buttons" aria-label="Seitennavigation"></div></div>
    </section>
    <div class="hint">${icon("info")}<span>Schema-Scans speichern Metadaten. Datenvorschauen werden nur auf Anfrage geladen und benötigen eine separate Freigabe.</span></div>
  </div>`);
  paintSources();
}
async function loadSources() {
  state.sources = await api("/api/sources");
}
async function navigate(view, id, target = {}) {
  if (view === "branding") view = "settings";
  if (view === "source") {
    state.source = state.sources.find((s) => s.id === Number(id));
    if (!state.source) {
      await loadSources();
      state.source = state.sources.find((s) => s.id === Number(id));
    }
    if (!state.source) throw new Error(uiText("Datenquelle nicht verfügbar."));
    state.view = "source";
    state.tab = ["er", "analysis"].includes(target.tab)
      ? target.tab
      : "overview";
    state.sa = null;
    state.saTable = target.table || null;
    state.table = 0;
    state.tableTab = "columns";
    state.highlightColumn = null;
    state.comparison = null;
    state.schedule = null;
    state.erPositions = {};
    state.erZoom = 1;
    state.erPan = { x: 0, y: 0 };
    state.snapshot = null;
    if (state.source.snapshot_id)
      state.snapshot = await api(`/api/sources/${id}/snapshot`);
    if (target.table && state.snapshot) {
      const index = state.snapshot.payload.tables.findIndex(
        (t) => t.key === target.table,
      );
      if (index >= 0) {
        if (target.tab !== "analysis") state.tab = "schema";
        state.table = index;
        state.tableTab = target.section === "notes" ? "notes" : "columns";
        state.highlightColumn = target.column || null;
      } else
        toast(uiText("Objekt ist im aktuellen Schema nicht mehr vorhanden."));
    }
    if (state.tab === "analysis") await analysisLoadSource(true);
    renderSource();
  } else {
    state.view = view;
    if (view === "sources") {
      await loadSources();
      renderSources();
    }
    if (view === "warehouse") {
      await loadSources();
      state.whWarehouses = await api("/api/dwh/warehouses");
      state.dwhProjects = await api("/api/dwh/projects");
      renderDwhProjects();
    }
    if (view === "warehouse-project") {
      await loadSources();
      state.dwhProject = await api(`/api/dwh/projects/${id}`);
      state.dwhTab = ["model", "mappings", "progress", "check"].includes(
        target.step,
      )
        ? target.step
        : "overview";
      state.dwhTableId = state.dwhProject.tables.some(
        (table) => table.id === target.table,
      )
        ? target.table
        : null;
      state.dwhComparison = null;
      state.dwhAssessment = null;
      renderDwhProject();
    }
    if (view === "warehouse-workspace") {
      await loadSources();
      whSet(await api(`/api/dwh/warehouses/${id}`));
      state.whTab = whTabs.some(([tab]) => tab === target.phase)
        ? target.phase
        : "overview";
      if (
        target.step &&
        whBuildSteps(state.wh).some((step) => step.id === target.step)
      )
        state.whGuide = { warehouseId: state.wh.id, step: target.step };
      state.whDepartmentFilter = "";
      state.whAreaFilter = "";
      state.whQuery = "";
      state.whLineageLimit = 100;
      renderWarehouseWorkspace();
    }
    if (view === "tools") {
      state.toolDesigns = await api("/api/tools/designs");
      renderTools();
    }
    if (view === "tool-design") {
      state.toolDesign = await api(`/api/tools/designs/${id}`);
      state.toolTab = ["model", "sql", "sharing"].includes(target.tab)
        ? target.tab
        : "model";
      state.toolTableId = target.table || null;
      state.toolSql = null;
      renderToolDesign();
    }
    if (view === "analysis") {
      await loadSources();
      state.analysisQuery = "";
      state.anSourcesPage = state.anConceptsPage = state.anSuggestionsPage = 1;
      await analysisLoadCatalog();
      renderAnalysisCatalog();
    }
    if (view === "search") {
      state.searchMode = target.mode === "finder" ? "finder" : "metadata";
      if (state.searchMode === "finder") renderFinder();
      else {
        if (target.q !== undefined) state.searchQuery = target.q;
        if (state.searchQuery.trim().length >= 2) await runSearch();
        else renderSearch();
      }
    }
    if (view === "profile") {
      state.profile = await api("/api/profile");
      state.user = { ...state.profile.user, language: state.profile.language };
      if (profileNeedsReload(state.user)) {
        location.reload();
        return;
      }
      renderProfile();
    }
    if (view === "users") {
      state.users = await api("/api/users");
      renderUsers();
    }
    if (view === "audit") {
      state.audit = await api("/api/audit");
      renderAudit();
    }
    if (view === "settings") {
      if (state.user.role !== "admin") {
        await navigate("sources");
        toast(uiText("Nur Administratoren dürfen diese Aktion ausführen."));
        return;
      }
      await loadBranding();
      renderBranding();
    }
  }
  const params = new URLSearchParams(
    view === "tool-design"
      ? {
          tab: state.toolTab,
          ...(state.toolTableId ? { table: state.toolTableId } : {}),
        }
      : view === "source"
        ? target
        : view === "warehouse-project" && state.dwhTab !== "overview"
          ? {
              step: state.dwhTab,
              ...(target.table ? { table: target.table } : {}),
            }
          : view === "warehouse-workspace"
            ? {
                phase: state.whTab,
                ...(state.whTab === "overview"
                  ? { step: whGuideSelection(state.wh).id }
                  : {}),
              }
            : view === "search" && state.searchMode === "finder"
              ? { mode: "finder" }
              : view === "search" && state.searchQuery
                ? { q: state.searchQuery }
                : {},
  );
  const hash =
    (view === "tool-design" ||
    view === "source" ||
    view === "warehouse-project" ||
    view === "warehouse-workspace"
      ? `${view}/${id}`
      : view) + (params.size ? "?" + params : "");
  if (location.hash.slice(1) !== hash) history.pushState(null, "", "#" + hash);
}
function tabs(items, current, action) {
  return `<div class="tabs">${items.map(([id, label, ic]) => `<button class="tab ${id === current ? "active" : ""}" aria-pressed="${id === current}" data-action="${action}" data-tab="${id}">${icon(ic)}${label}</button>`).join("")}</div>`;
}
function renderSource() {
  const s = state.source;
  shell(
    localize`${state.whReturn ? whButton("Zur Warehouse-Gesamtübersicht", "return", state.whReturn.id) : ""}${state.dwhReturnProject ? `<button class="back dwh-return" data-action="dwh-return">${icon("back")} ${e(uiText("Zurück zum DWH-Projekt: {0}", state.dwhReturnProject.name))}</button>` : ""}<button class="back" data-action="nav" data-view="sources">${icon("back")} Alle Datenquellen</button><div class="page-head"><div><div class="source-heading"><div class="db-icon ${s.kind}">${databaseLogo(s.kind)}</div><div><div class="eyebrow">${names[s.kind]}</div><h1>${e(s.name)}</h1></div></div><p>${e(s.kind === "sqlite" ? s.config.path : s.config.host + " / " + s.config.database)} ${s.config.schema ? "· " + e(s.config.schema) : ""}</p></div><div class="actions">${s.snapshot_id ? localize`<a class="btn" href="/api/sources/${s.id}/export?format=markdown">${icon("download")} Markdown</a><a class="btn" href="/api/sources/${s.id}/export?format=json">JSON</a><button class="btn" data-action="pdf-tables" title="Alle dokumentierten Tabellen als PDF exportieren">${icon("download")} Tabellen-PDF</button>` : ""}${s.can_edit ? localize`<button class="btn" data-action="edit-source">${icon("edit")} Bearbeiten</button><button class="btn primary" data-action="scan" ${["queued", "running"].includes(s.job?.status) ? "disabled" : ""}>${icon("refresh")} ${["queued", "running"].includes(s.job?.status) ? uiText("Scan läuft …") : uiText("Schema scannen")}</button>` : ""}</div></div>${s.job ? `<div class="status-message">${status(s)} <span style="margin-left:10px">${e(uiMessage(s.job.message))}</span></div>` : ""}${tabs(
      [
        ["overview", uiText("Übersicht"), "grid"],
        ["schema", uiText("Tabellen & Felder"), "table"],
        ["er", uiText("ER-Modell"), "relations"],
        ["analysis", uiText("Analyse"), "grid"],
        ["compare", uiText("Schema-Vergleich"), "relations"],
        ["history", uiText("Scan-Verlauf"), "clock"],
        ["organization", uiText("Tags & Verantwortliche"), "users"],
        ["schedule", uiText("Automatische Scans"), "clock"],
      ],
      state.tab,
      "source-tab",
    )}<div id="source-body">${sourceBody()}</div>`,
  );
  if (state.tab === "er") setupER();
  if (state.tab === "analysis") analysisPaint();
}
function info(label, value) {
  return `<div class="info-line"><span>${label}</span><span>${value}</span></div>`;
}
function sourceBody() {
  const s = state.source,
    snap = state.snapshot;
  if (state.tab === "analysis") return sourceAnalysisView();
  if (state.tab === "history") return historyView();
  if (state.tab === "organization") return organizationView();
  if (state.tab === "schedule") return scheduleView();
  if (state.tab === "compare") return comparisonView();
  if (!snap)
    return localize`<div class="empty">${icon("table")}<h2>Die Dokumentation beginnt mit einem Scan</h2><p>${s.can_edit ? uiText("DatabaseDoc liest die Struktur der Datenbank aus und erstellt daraus Tabellenübersichten und Beziehungen.") : uiText("Ein Bearbeiter muss zunächst einen Schema-Scan starten.")}</p>${s.can_edit ? localize('<button class="btn primary" data-action="scan">Schema scannen</button>') : ""}</div>`;
  if (state.tab === "schema") return schemaView();
  if (state.tab === "er") return erView();
  return localize`${sourceStats([s])}<div class="info-grid"><section class="panel"><div class="panel-head"><h2>Verbindungsinformationen</h2>${status(s)}</div><div class="panel-body">${info("Tags", tagList(s.tags, s))}${info(uiText("Verantwortlich"), e(s.owner || uiText("Nicht zugewiesen")))}${info(uiText("Kontakt"), e(s.owner_email || "—"))}${info(uiText("Automatische Scans"), s.schedule?.enabled ? e({ hourly: uiText("Stündlich"), daily: uiText("Täglich"), weekly: uiText("Wöchentlich") }[s.schedule.cadence]) + " · " + e(dt(s.schedule.next_run)) : uiText("Deaktiviert"))}${info(uiText("Datenbanktyp"), names[s.kind])}${info(uiText("Datenbank"), e(s.config.database || uiText("SQLite-Datei")))}${info(uiText("Host / Datei"), e(s.config.host || s.config.path))}${info("Schema", e(s.config.schema || uiText("Alle zugänglichen Schemas")))}${info(uiText("Letzter Scan"), e(dt(s.scanned_at)))}${info(uiText("Deine Berechtigungen"), (s.can_edit ? uiText("Bearbeiten") : uiText("Lesen")) + (s.can_data ? " · Datenvorschau" : ""))}</div></section><section class="panel"><div class="panel-head"><h2>Dokumentierte Objekte</h2><button class="text-button" data-action="source-tab" data-tab="schema">Alle anzeigen →</button></div><div class="table-wrap"><table><thead><tr><th>Objekt</th><th>Typ</th><th>Spalten</th></tr></thead><tbody>${snap.payload.tables
    .slice(0, 7)
    .map(
      (t, i) =>
        `<tr><td><button class="text-button source-table-name" data-action="select-table" data-index="${i}">${e(t.schema ? t.schema + "." + t.name : t.name)}</button></td><td class="muted">${e(t.kind)}</td><td>${t.columns.length}</td></tr>`,
    )
    .join(
      "",
    )}</tbody></table>${!snap.payload.tables.length ? localize('<div class="panel-body muted">Keine zugänglichen Objekte gefunden.</div>') : ""}</div></section></div>${snap.payload.warnings.map((w) => `<div class="hint">${icon("info")}<span>${e(uiMessage(w))}</span></div>`).join("")}<div class="hint">${icon("clock")}<span>Die Dokumentation zeigt den Stand des letzten Scans. Starte nach Strukturänderungen einen neuen Scan.</span></div>`;
}
function schemaView() {
  const tables = state.snapshot.payload.tables;
  if (!tables.length)
    return localize(
      '<div class="empty"><h2>Keine Tabellen oder Collections gefunden</h2></div>',
    );
  state.table = Math.min(state.table, tables.length - 1);
  return localize`<div class="schema-layout"><aside class="object-list"><div class="object-search"><input id="object-search" aria-label="Objekte durchsuchen" placeholder="Objekte durchsuchen …"></div><div class="object-items" id="object-items">${tableList()}</div></aside><section class="panel object-detail" id="object-detail">${tableDetail()}</section></div>`;
}
function tableList(query = "") {
  return state.snapshot.payload.tables
    .map(
      (t, i) =>
        `${(t.schema + "." + t.name).toLowerCase().includes(query.toLowerCase()) ? `<button class="object-item ${state.table === i ? "active" : ""}" data-action="select-table" data-index="${i}">${icon("table")}<span title="${e(t.schema + "." + t.name)}">${e(t.name)}</span><small>${t.columns.length}</small></button>` : ""}`,
    )
    .join("");
}
function tableDetail() {
  const t = state.snapshot.payload.tables[state.table];
  return localize`<div class="panel-head"><div><div class="eyebrow" style="margin-bottom:3px">${e(t.schema || uiText("Standard-Schema"))} · ${e(t.kind)}</div><h2>${e(t.name)}</h2><p class="object-description">${e(t.comment || "")}${t.sampled_documents !== undefined ? " · " + t.sampled_documents + " Dokumente für Feldableitung untersucht" : ""}</p></div><div class="actions"><span class="badge neutral">${t.columns.length} Felder</span><button class="btn" data-action="pdf-table" title="Diese Tabelle mit Spalten, Schlüsseln und Notizen als PDF exportieren">${icon("download")} Tabellen-PDF</button></div></div><div class="detail-tabs">${tabs(
    [
      ["columns", uiText("Spalten"), "columns"],
      ["keys", uiText("Schlüssel & Indizes"), "relations"],
      ["data", uiText("Datenvorschau"), "eye"],
      ["notes", uiText("Dokumentation"), "file"],
    ],
    state.tableTab,
    "table-tab",
  )}</div><div id="table-body">${tableBody()}</div>`;
}
function tableBody() {
  const t = state.snapshot.payload.tables[state.table];
  if (state.tableTab === "data")
    return localize`<div class="panel-body"><p class="muted small" style="margin-bottom:18px">Die Vorschau liest maximal 50 Zeilen direkt aus der Datenquelle. Werte werden nicht in der Dokumentationsdatenbank gespeichert.</p>${state.source.can_data ? localize`<button class="btn" data-action="load-preview">${icon("eye")} Datenvorschau laden</button><div id="preview-result" style="margin-top:20px"></div>` : localize('<div class="hint" style="margin:0">Für Datenvorschauen fehlt dir die Freigabe. Wende dich an einen Administrator.</div>')}</div>`;
  if (state.tableTab === "notes")
    return localize`<div class="panel-body"><form id="note-form" class="note-form"><div class="field"><label for="note">Beschreibung & Fachwissen</label><textarea id="note" name="text" rows="10" placeholder="Zweck, Datenherkunft, Verantwortliche oder fachliche Besonderheiten …" ${!state.source.can_edit ? "readonly" : ""}>${e(state.snapshot.notes[t.key] || "")}</textarea><small>Diese Notiz bleibt auch nach einem erneuten Scan erhalten.</small></div>${state.source.can_edit ? localize('<button class="btn primary" type="submit">Dokumentation speichern</button>') : ""}</form></div>`;
  if (state.tableTab === "keys")
    return localize`<div class="panel-body"><h3>Primärschlüssel</h3><p class="mono muted" style="margin:8px 0 22px">${e(t.primary_key.join(", ") || uiText("Kein Primärschlüssel erkannt"))}</p><h3>Fremdschlüssel</h3>${t.foreign_keys.length ? localize`<div class="table-wrap" style="margin:10px 0 22px"><table><thead><tr><th>Spalten</th><th>Ziel</th><th>Zielspalten</th></tr></thead><tbody>${t.foreign_keys.map((f) => `<tr><td class="mono">${e(f.columns.join(", "))}</td><td>${e(f.target_schema + "." + f.target_table)}</td><td class="mono">${e(f.target_columns.join(", "))}</td></tr>`).join("")}</tbody></table></div>` : localize('<p class="muted small" style="margin:8px 0 22px">Keine deklarierten Fremdschlüssel.</p>')}<h3>Indizes & eindeutige Constraints</h3><div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>Name</th><th>Spalten</th><th>Eindeutig</th></tr></thead><tbody>${[...t.indexes, ...t.unique_constraints.map((u) => ({ ...u, unique: true }))].map((i) => `<tr><td>${e(i.name || uiText("Ohne Namen"))}</td><td class="mono">${e(i.columns.join(", "))}</td><td>${i.unique ? uiText("Ja") : uiText("Nein")}</td></tr>`).join("")}</tbody></table></div>${t.validator ? localize`<h3 style="margin-top:22px">MongoDB-Validator</h3><pre class="mono" style="overflow:auto">${e(JSON.stringify(t.validator, null, 2))}</pre>` : ""}</div>`;
  return localize`<div class="table-wrap"><table><thead><tr><th>Spalte / Feld</th><th>Datentyp</th><th>NULL</th><th>Standard</th><th>Kommentar</th></tr></thead><tbody>${t.columns.map((c) => `<tr class="${state.highlightColumn === c.name ? "search-highlight" : ""}"><td class="mono">${c.primary_key ? '<span class="key-label">PK</span>' : ""}${t.foreign_keys.some((f) => f.columns.includes(c.name)) ? '<span class="key-label fk">FK</span>' : ""}${e(c.name)}</td><td class="mono muted">${e(c.type)}</td><td>${c.nullable ? uiText("Ja") : uiText("Nein")}</td><td class="mono muted">${e(c.default ?? "—")}</td><td class="muted">${e(c.comment || "—")}</td></tr>`).join("")}</tbody></table>${!t.columns.length ? localize('<div class="panel-body muted">Keine Felder dokumentiert. Bei MongoDB kann die optionale Feldableitung in der Verbindung aktiviert werden.</div>') : ""}</div>`;
}
function historyView() {
  return localize`<section class="panel"><div class="panel-head"><h2>Gespeicherte Schema-Stände</h2><span class="small muted">${state.history.length} Scans</span></div><div class="table-wrap"><table><thead><tr><th>Stand</th><th>Objekte</th><th></th></tr></thead><tbody>${state.history.map((h) => localize`<tr><td>${e(dt(h.created))}</td><td>${h.table_count}</td><td><button class="text-button" data-action="history-open" data-id="${h.id}">Schema ansehen →</button></td></tr>`).join("")}</tbody></table>${!state.history.length ? localize('<div class="panel-body muted">Noch keine erfolgreichen Scans.</div>') : ""}</div></section>`;
}
function erView() {
  if (!state.snapshot.payload.tables.length)
    return localize(
      '<div class="empty"><h2>Keine Objekte für das ER-Modell</h2></div>',
    );
  return localize`<section class="panel"><div class="panel-head"><div><h2>Beziehungen im Überblick</h2><p class="muted small">${state.source.kind === "mongodb" ? uiText("Collections und abgeleitete Felder. MongoDB deklariert keine Fremdschlüssel.") : uiText("Pfeile führen von Fremdschlüsseln zur referenzierten Tabelle.")}</p></div><span class="small muted">${state.snapshot.payload.tables.length.toLocaleString(uiLocale)} ${uiText("Objekte")}</span></div><div class="diagram-explorer">${diagramToolbar(true)}<div class="er-stage diagram-stage"><svg id="er-svg" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="${e(uiText("ER-Modell der dokumentierten Datenbank"))}"></svg>${diagramMiniMap()}</div>${diagramHelp(true)}</div></section>`;
}
function erTables() {
  return state.snapshot.payload.tables;
}
function erHeight(t) {
  return (
    50 + Math.min(t.columns.length, 6) * 22 + (t.columns.length > 6 ? 22 : 0)
  );
}
function drawER() {
  const svg = document.getElementById("er-svg");
  if (!svg) return;
  const ts = erTables();
  const columns = Math.max(1, Math.ceil(Math.sqrt(ts.length)));
  const rowHeight = Math.max(200, ...ts.map(erHeight)) + 45;
  const lookup = new Map(
    ts.map((t) => [JSON.stringify([t.schema || "", t.name]), t]),
  );
  const graph = new Map(ts.map((t) => [t.key, new Set()]));
  for (const table of ts)
    for (const fk of table.foreign_keys) {
      const target = lookup.get(
        JSON.stringify([
          fk.target_schema || table.schema || "",
          fk.target_table,
        ]),
      );
      if (target) {
        graph.get(table.key).add(target.key);
        graph.get(target.key).add(table.key);
      }
    }
  const visited = new Set(),
    order = [];
  for (const table of ts) {
    if (visited.has(table.key)) continue;
    const queue = [table.key];
    visited.add(table.key);
    for (let at = 0; at < queue.length; at++) {
      const key = queue[at];
      order.push(key);
      for (const neighbor of graph.get(key)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
  }
  order.forEach((key, i) => {
    if (!state.erPositions[key])
      state.erPositions[key] = {
        x: 35 + (i % columns) * 330,
        y: 30 + Math.floor(i / columns) * rowHeight,
      };
  });
  const defs =
    '<defs><marker id="arrowhead" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 8 4 0 8" fill="none" stroke="#87a693"/></marker><filter id="node-shadow"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#163a35" flood-opacity="0.06"/></filter></defs>';
  svg.innerHTML =
    defs +
    `<g id="er-edges">${sourceERLinks(ts)}</g>` +
    ts
      .map((t, i) => {
        const p = state.erPositions[t.key];
        return localize`<g class="er-node" tabindex="0" role="button" aria-label="${e(t.name)} öffnen" data-er-index="${i}" data-nav-id="${e(t.key)}" transform="translate(${p.x},${p.y})"><rect width="280" height="${erHeight(t)}" rx="9" fill="white" stroke="#cbd9c9" filter="url(#node-shadow)"/><path d="M0 37H280" stroke="#dee7da"/><title>${e((t.schema ? t.schema + "." : "") + t.name)}</title><text class="er-title" x="14" y="24">${e(((t.schema ? t.schema + "." : "") + t.name).slice(0, 40))}</text>${t.columns
          .slice(0, 6)
          .map(
            (c, j) =>
              `<text class="er-field" x="14" y="${58 + j * 22}">${c.primary_key ? "◆ " : t.foreign_keys.some((f) => f.columns.includes(c.name)) ? "↗ " : "  "}${e(c.name.length > 21 ? c.name.slice(0, 20) + "…" : c.name)}</text><text class="er-field" x="266" y="${58 + j * 22}" text-anchor="end" fill="#83957c">${e(c.type.slice(0, 14))}</text>`,
          )
          .join(
            "",
          )}${t.columns.length > 6 ? localize`<text class="er-field" x="14" y="${58 + 6 * 22}">+ ${t.columns.length - 6} weitere Felder</text>` : ""}</g>`;
      })
      .join("");
}
function sourceERLinks(ts = erTables()) {
  const lookup = new Map(
    ts.map((t) => [JSON.stringify([t.schema || "", t.name]), t]),
  );
  let edges = "";
  ts.forEach((t) =>
    t.foreign_keys.forEach((f) => {
      const target = lookup.get(
        JSON.stringify([f.target_schema || t.schema || "", f.target_table]),
      );
      if (!target) return;
      const a = state.erPositions[t.key],
        b = state.erPositions[target.key];
      const aRight = a.x <= b.x;
      const x1 = a.x + (aRight ? 280 : 0),
        x2 = b.x + (aRight ? 0 : 280);
      const sourceColumn = Math.max(
        0,
        t.columns.findIndex((c) => f.columns.includes(c.name)),
      );
      const targetColumn = Math.max(
        0,
        target.columns.findIndex((c) => f.target_columns.includes(c.name)),
      );
      const y1 = a.y + 54 + Math.min(sourceColumn, 5) * 22,
        y2 = b.y + 54 + Math.min(targetColumn, 5) * 22;
      let d;
      if (target === t) {
        d = `M${x1},${y1} C${x1 + 60},${y1 - 60} ${x1 + 60},${y2 + 60} ${x1},${y2}`;
      } else {
        const mid = (x1 + x2) / 2;
        d = `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
      }
      edges += `<path class="er-edge" data-edge-source="${e(t.key)}" data-edge-target="${e(target.key)}" d="${d}" marker-end="url(#arrowhead)"><title>${e(t.name + ": " + f.columns.join(", ") + " → " + target.name + " (" + f.target_columns.join(", ") + ")")}</title></path>`;
    }),
  );
  return edges;
}
function setupER() {
  const svg = document.getElementById("er-svg");
  if (!svg) return;
  svg.diagramNavigation?.destroy();
  const scope = `source:${state.source.id}:${state.snapshot.id}`;
  if (state.erScope !== scope) {
    state.erPositions = {};
    state.erScope = scope;
  }
  drawER();
  const ts = erTables(),
    byId = new Map();
  const nodes = [...svg.querySelectorAll("[data-nav-id]")].map((element) => {
    const t = ts[Number(element.dataset.erIndex)],
      position = state.erPositions[t.key];
    const node = {
      id: t.key,
      label: (t.schema ? t.schema + "." : "") + t.name,
      ...position,
      width: 280,
      height: erHeight(t),
      element,
      neighbors: new Set(),
    };
    byId.set(t.key, node);
    return node;
  });
  for (const edge of svg.querySelectorAll("[data-edge-source]")) {
    byId.get(edge.dataset.edgeSource)?.neighbors.add(edge.dataset.edgeTarget);
    byId.get(edge.dataset.edgeTarget)?.neighbors.add(edge.dataset.edgeSource);
  }
  diagramNavigator(svg, nodes, {
    scope,
    onCamera: (box, zoom) => {
      state.erZoom = zoom;
      state.erPan = { x: box.x, y: box.y };
    },
    openNode: (id) => selectTable(ts.findIndex((t) => t.key === id)),
    moveNode: (id, position) => {
      state.erPositions[id] = position;
      byId
        .get(id)
        .element.setAttribute(
          "transform",
          `translate(${position.x},${position.y})`,
        );
      document.getElementById("er-edges").innerHTML = sourceERLinks();
    },
  });
}
function downloadER() {
  const source = document.getElementById("er-svg").cloneNode(true);
  const styles = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "style",
  );
  styles.textContent =
    ".er-edge{fill:none;stroke:#87a693;stroke-width:1.5}.er-title{font-family:sans-serif;font-weight:600;font-size:13px;fill:#22473a}.er-field{font-family:monospace;font-size:10px;fill:#56685b}";
  source.prepend(styles);
  const bounds = document.getElementById("er-svg").diagramNavigation.bounds();
  source.setAttribute(
    "viewBox",
    `${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`,
  );
  source.setAttribute("preserveAspectRatio", "xMidYMid meet");
  source.setAttribute("width", "1400");
  source.setAttribute(
    "height",
    String(Math.max(200, Math.ceil((1400 * bounds.height) / bounds.width))),
  );
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(source)], {
      type: "image/svg+xml",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `databasedoc-${state.source.id}-er.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function downloadPdf(format, tableKey = null) {
  const sourceId = state.source.id;
  const params = new URLSearchParams({
    format,
    snapshot_id: state.snapshot?.id || state.source.snapshot_id,
  });
  if (tableKey !== null) params.set("table_key", tableKey);
  const response = await fetch(`/api/sources/${sourceId}/export?${params}`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    if (response.status === 401) {
      finderReset();
      state.user = null;
      await showLogin();
    }
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : uiText("PDF-Export fehlgeschlagen."),
    );
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `databasedoc-${sourceId}-${format === "er_pdf" ? "er" : tableKey !== null ? "table" : "tables"}.pdf`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function renderUsers() {
  shell(
    localize`<div class="page-head"><div><div class="eyebrow">Administration</div><h1>Benutzer & Rechte</h1><p>Konten verwalten und Datenbanken gezielt freigeben.</p></div><button class="btn primary" data-action="add-user">${icon("plus")} Benutzer hinzufügen</button></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Benutzer</th><th>Anmeldung</th><th>Rolle</th><th>Status</th><th></th></tr></thead><tbody>${state.users.map((u) => localize`<tr><td><strong>${e(u.display_name)}</strong><div class="small muted">${e(u.username)}</div></td><td>${{ local: uiText("Lokales Konto"), ad: "Microsoft AD", entra: "Entra ID" }[u.provider]}</td><td>${roles[u.role]}</td><td><span class="badge ${u.active ? "" : "error"}">${u.active ? uiText("Aktiv") : uiText("Deaktiviert")}</span></td><td><button class="text-button" data-action="edit-user" data-id="${u.id}">Verwalten</button></td></tr>`).join("")}</tbody></table></div></section><div class="hint">${icon("shield")}<span>Administratoren sehen alle Quellen. Bearbeiter benötigen zusätzlich eine Freigabe zum Bearbeiten; Leser erhalten ausschließlich freigegebene Dokumentationen. Neue Entra- und AD-Konten starten als Leser ohne Datenbankzugriff.</span></div><section style="margin-top:28px"><div class="section-title"><h2>Datenbankfreigaben</h2></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Datenquelle</th><th>Typ</th><th></th></tr></thead><tbody>${state.sources.map((s) => localize`<tr><td>${e(s.name)}</td><td class="muted">${names[s.kind]}</td><td><button class="text-button" data-action="grants" data-id="${s.id}">Freigaben verwalten →</button></td></tr>`).join("")}</tbody></table>${!state.sources.length ? localize('<div class="panel-body muted">Lege zunächst eine Datenquelle an.</div>') : ""}</div></section></section>`,
  );
}
const auditLabels = {
  profile_updated: uiText("Profil aktualisiert"),
  tag_style_saved: uiText("Tag-Definition gespeichert"),
  tag_style_deleted: uiText("Tag-Definition entfernt"),
  source_metadata_updated: uiText("Tags und Verantwortliche gespeichert."),
  warehouse_removed: uiText("Warehouse-Verwaltung entfernt"),
  warehouse_created: uiText("Warehouse angelegt"),
  warehouse_updated: uiText("Warehouse geändert"),
  warehouse_project_adopted: uiText("Projekt ins Warehouse übernommen"),
  analysis_preparation_saved: uiText("DWH-Vorbereitung gespeichert"),
  analysis_rules_saved: uiText("Qualitätsregeln gespeichert"),
  analysis_profile_created: uiText("Datenprofil erstellt"),
  finder_value_search: uiText("Beispielwert-Suche ausgeführt"),
  analysis_concept_saved: uiText("Fachbegriff gespeichert"),
  analysis_concept_removed: uiText("Fachbegriff entfernt"),
  company_logo_updated: uiText("Firmenlogo gespeichert"),
  company_logo_removed: uiText("Firmenlogo entfernt"),
  dwh_project_saved: uiText("DWH-Projekt gespeichert"),
  dwh_project_deleted: uiText("DWH-Projekt gelöscht"),
  dwh_project_exported: uiText("DWH-Projekt exportiert"),
  login: uiText("Angemeldet"),
  logout: uiText("Abgemeldet"),
  login_failed: uiText("Anmeldung fehlgeschlagen"),
  password_changed: uiText("Passwort geändert"),
  source_created: uiText("Datenquelle angelegt"),
  source_updated: uiText("Datenquelle geändert"),
  source_deleted: uiText("Datenquelle gelöscht"),
  scan_started: uiText("Schema-Scan gestartet"),
  data_preview: uiText("Datenvorschau geladen"),
  note_updated: uiText("Dokumentation geändert"),
  documentation_export: uiText("Dokumentation exportiert"),
  user_created: uiText("Benutzer angelegt"),
  user_updated: uiText("Benutzer geändert"),
  grant_updated: uiText("Freigabe geändert"),
  grant_revoked: uiText("Freigabe entfernt"),
};
function renderAudit() {
  shell(
    localize`<div class="page-head"><div><div class="eyebrow">Administration</div><h1>Aktivitätsprotokoll</h1><p>Die letzten 200 Anmeldungen und Änderungen.</p></div><button class="btn" data-action="nav" data-view="audit">${icon("refresh")} Aktualisieren</button></div><section class="panel"><div class="table-wrap"><table><thead><tr><th>Zeitpunkt</th><th>Benutzer</th><th>Aktion</th><th>Ziel</th></tr></thead><tbody>${state.audit.map((a) => `<tr><td class="nowrap">${e(dt(a.created))}</td><td>${e(a.user)}</td><td>${e(auditLabels[a.action] || a.action)}</td><td class="mono muted">${e(a.target || "—")}</td></tr>`).join("")}</tbody></table></div></section>`,
  );
}
function openModal(title, html) {
  modal.innerHTML = localize`<div class="modal-head"><h2>${e(title)}</h2><button class="btn ghost" data-action="close-modal" aria-label="Schließen">${icon("x")}</button></div><div class="modal-body">${html}</div>`;
  modal.showModal();
}
function field(label, name, value = "", type = "text", extra = "") {
  return `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${e(value)}" ${extra}></div>`;
}
function sourceModal(edit = false) {
  const s = edit ? state.source : null,
    c = s?.config || {};
  openModal(
    edit ? uiText("Datenquelle bearbeiten") : uiText("Datenquelle hinzufügen"),
    localize`<form id="source-form" data-id="${s?.id || ""}"><div class="form-grid"><div class="full">${field(uiText("Bezeichnung"), "name", s?.name || "", "text", localize('required maxlength="190" placeholder="z. B. Produktions-DWH"'))}</div><div class="field full"><label for="f-kind">Datenbanksystem</label><select name="kind" id="f-kind">${Object.entries(
      names,
    )
      .map(
        ([k, n]) =>
          `<option value="${k}" ${s?.kind === k ? "selected" : ""}>${n}</option>`,
      )
      .join(
        "",
      )}</select></div><div class="network-field">${field("Host", "host", c.host || "", "text", 'placeholder="db.example.local"')}</div><div class="network-field">${field("Port", "port", c.port || "", "number", localize('min="1" max="65535" placeholder="Standardport"'))}</div><div class="network-field">${field(uiText("Datenbank"), "database", c.database || "", "text", 'maxlength="190" list="database-options"')}<datalist id="database-options"></datalist><button class="text-button small" type="button" data-action="discover" style="margin-top:5px">Datenbanken auf dem Server suchen</button></div><div class="network-field sql-schema">${field(uiText("Schema (optional)"), "schema_name", c.schema || "", "text", localize('placeholder="Alle zugänglichen Schemas" maxlength="190"'))}</div><div class="network-field">${field(uiText("Benutzername"), "username", c.username || "", "text", 'autocomplete="off" maxlength="190"')}</div><div class="network-field">${field(s ? uiText("Passwort (leer = beibehalten)") : uiText("Passwort"), "password", "", "password", 'autocomplete="new-password"')}</div><div class="sqlite-field full">${field(uiText("SQLite-Datei im Container"), "path", c.path || "", "text", 'placeholder="/sources/meine-datenbank.db"')}<div class="small muted" style="margin-top:6px">Datei auf dem Server unter /opt/datenbankdokumentation/sources ablegen. Sie wird nur lesend eingebunden.</div></div><div class="mongo-field full">${field(uiText("Authentifizierungsdatenbank"), "auth_source", c.auth_source || "", "text", localize('placeholder="Standard: ausgewählte Datenbank"'))}</div></div><label class="checkbox network-field"><input name="tls" type="checkbox" ${c.tls !== false ? "checked" : ""}><span>TLS mit Zertifikatsprüfung verwenden. Nur für lokale Testdatenbanken ohne TLS deaktivieren.</span></label><label class="checkbox mongo-field"><input name="mongo_infer" type="checkbox" ${s?.mongo_infer ? "checked" : ""}><span>Felder aus bis zu 100 Dokumenten pro Collection ableiten. Hierfür werden Dokumente gelesen; ihre Werte werden nicht gespeichert.</span></label><div class="error-text" id="source-error" role="alert"></div><div class="modal-footer"><button class="btn" type="button" data-action="test-connection">${icon("server")} Verbindung testen</button><div class="actions"><button class="btn" type="button" data-action="close-modal">Abbrechen</button><button class="btn primary" type="submit">Speichern</button></div></div>${s && state.user.role === "admin" ? localize('<button class="btn danger" type="button" data-action="delete-source" style="justify-self:start">Datenquelle löschen</button>') : ""}</form>`,
  );
  sourceFormKind();
}
function sourceFormKind() {
  const kind = document.getElementById("f-kind").value;
  modal
    .querySelectorAll(".network-field")
    .forEach((el) => el.classList.toggle("hidden", kind === "sqlite"));
  modal
    .querySelectorAll(".sqlite-field")
    .forEach((el) => el.classList.toggle("hidden", kind !== "sqlite"));
  modal
    .querySelectorAll(".mongo-field")
    .forEach((el) => el.classList.toggle("hidden", kind !== "mongodb"));
  modal
    .querySelectorAll(".sql-schema")
    .forEach((el) =>
      el.classList.toggle("hidden", kind === "sqlite" || kind === "mongodb"),
    );
  const defaults = {
    mssql: 1433,
    mysql: 3306,
    mariadb: 3306,
    postgresql: 5432,
    mongodb: 27017,
  };
  document.getElementById("f-port").placeholder = String(defaults[kind] || "");
}
function sourceInput() {
  const form = document.getElementById("source-form"),
    data = new FormData(form);
  return {
    name: data.get("name"),
    kind: data.get("kind"),
    host: data.get("host"),
    port: data.get("port") ? Number(data.get("port")) : null,
    database: data.get("database"),
    schema_name: data.get("schema_name"),
    username: data.get("username"),
    password: data.get("password") || null,
    path: data.get("path"),
    tls: data.get("tls") === "on",
    mongo_infer: data.get("mongo_infer") === "on",
    auth_source: data.get("auth_source"),
  };
}
function addUserModal() {
  openModal(
    uiText("Lokalen Benutzer hinzufügen"),
    localize`<form id="user-form">${field(uiText("Anzeigename"), "display_name", "", "text", 'required maxlength="190"')}${field(uiText("Benutzername"), "username", "", "text", 'required pattern="[a-zA-Z0-9_.@\\-]+" autocomplete="off" maxlength="190"')}${field(uiText("Passwort"), "password", "", "password", 'required minlength="12" autocomplete="new-password"')}<div class="field"><label for="f-role">Rolle</label><select name="role" id="f-role"><option value="viewer">Leser</option><option value="editor">Bearbeiter</option><option value="admin">Administrator</option></select></div><div class="error-text" id="form-error" role="alert"></div><div class="modal-footer"><span class="small muted">Mindestens 12 Zeichen im Passwort.</span><button type="submit" class="btn primary">Benutzer anlegen</button></div></form>`,
  );
}
function editUserModal(id) {
  const u = state.users.find((u) => u.id === Number(id));
  openModal(
    uiText("Benutzer verwalten"),
    localize`<form id="user-edit-form" data-id="${u.id}"><p>${e(u.display_name)} <span class="muted">(${e(u.username)})</span></p><div class="field"><label for="f-role">Rolle</label><select name="role" id="f-role">${Object.entries(
      roles,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${u.role === k ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select></div><label class="checkbox"><input name="active" type="checkbox" ${u.active ? "checked" : ""}>Konto aktiv</label><div class="error-text" id="form-error" role="alert"></div><div class="modal-footer"><span class="small muted">Änderungen beenden bestehende Sitzungen.</span><button class="btn primary" type="submit">Speichern</button></div></form>`,
  );
}
async function grantsModal(id) {
  const source = state.sources.find((s) => s.id === Number(id));
  state.users = await api("/api/users");
  const grants = await api(`/api/sources/${id}/grants`);
  const people = state.users.filter((u) => u.role !== "admin");
  openModal(
    "Freigaben · " + source.name,
    localize`<p class="small muted" style="margin-bottom:16px">„Lesen“ erlaubt die Dokumentation. Bearbeiten setzt die Rolle Bearbeiter voraus. Datenvorschauen und Datenprofile werden separat freigegeben.</p><form id="grants-form" data-id="${id}">${people
      .map((u) => {
        const g = grants.find((g) => g.user_id === u.id);
        return localize`<div class="grant-row" data-user="${u.id}"><div>${e(u.display_name)}<div class="muted small">${roles[u.role]}</div></div><label><input type="checkbox" name="read-${u.id}" ${g ? "checked" : ""}>Lesen</label><label><input type="checkbox" name="edit-${u.id}" ${g?.edit ? "checked" : ""} ${u.role !== "editor" ? "disabled" : ""}>Bearbeiten</label><label><input type="checkbox" name="data-${u.id}" ${g?.data ? "checked" : ""}>Daten</label></div>`;
      })
      .join(
        "",
      )}${!people.length ? localize('<p class="muted">Es gibt noch keine Leser oder Bearbeiter. Lege zuerst einen Benutzer an.</p>') : ""}<div class="error-text" id="form-error" role="alert"></div><div class="modal-footer"><span class="small muted">Administratoren haben Zugriff auf alle Quellen.</span><button class="btn primary" type="submit">Freigaben speichern</button></div></form>`,
  );
}
function passwordModal() {
  openModal(
    uiText("Passwort ändern"),
    localize`<form id="password-form">${field(uiText("Aktuelles Passwort"), "current_password", "", "password", 'required autocomplete="current-password"')}${field(uiText("Neues Passwort"), "password", "", "password", 'required minlength="12" autocomplete="new-password"')}<div class="error-text" id="form-error" role="alert"></div><div class="modal-footer"><span class="small muted">Andere Sitzungen werden beendet.</span><button type="submit" class="btn primary">Passwort ändern</button></div></form>`,
  );
}
function selectTable(index) {
  state.table = index;
  state.tableTab = "columns";
  if (state.tab !== "schema") {
    state.tab = "schema";
    renderSource();
  } else {
    document.getElementById("object-items").innerHTML = tableList(
      document.getElementById("object-search").value,
    );
    document.getElementById("object-detail").innerHTML = tableDetail();
  }
}
async function refreshSnapshot() {
  const key = state.snapshot?.payload.tables[state.table]?.key;
  const snapshot = await api(`/api/sources/${state.source.id}/snapshot`);
  const index = snapshot.payload.tables.findIndex((t) => t.key === key);
  state.snapshot = snapshot;
  state.table = Math.max(0, index);
}
async function changeSourceTab(tab) {
  state.source =
    state.sources.find((s) => s.id === state.source.id) || state.source;
  state.tab = tab;
  if (tab === "analysis")
    await analysisLoadSource(state.sa?.source_id !== state.source.id);
  if (tab === "history" || tab === "compare")
    state.history = await api(`/api/sources/${state.source.id}/history`);
  if (
    tab !== "history" &&
    state.snapshot?.id !== state.source.snapshot_id &&
    state.source.snapshot_id
  )
    await refreshSnapshot();
  if (tab === "schedule")
    state.schedule = await api(`/api/sources/${state.source.id}/schedule`);
  if (tab === "compare") {
    state.compareBefore = state.history[1]?.id || null;
    state.compareAfter = state.history[0]?.id || null;
    state.comparison = null;
    if (state.compareBefore) await loadComparison();
  }
  renderSource();
  if (tab === "analysis")
    history.replaceState(null, "", `#source/${state.source.id}?tab=analysis`);
  else if (location.hash.includes("tab=analysis"))
    history.replaceState(null, "", `#source/${state.source.id}`);
}
document.addEventListener("click", async (ev) => {
  const button = ev.target.closest("[data-action]");
  if (!button) return;
  const a = button.dataset.action;
  try {
    if (a.startsWith("df-")) await finderClick(button);
    if (a.startsWith("an-")) await analysisClick(button);
    if (a.startsWith("wa-")) await warehouseAssessmentClick(button);
    if (a.startsWith("tool-")) await toolsClick(button);
    if (a.startsWith("ct-")) await classificationClick(button);
    if (a.startsWith("wh-")) await warehouseWorkspaceClick(button);
    if (a.startsWith("dwh-")) await warehouseClick(button);
    if (a === "search-page") {
      state.searchPage = Number(button.dataset.page);
      await runSearch();
    }
    if (a === "search-open") {
      const item = state.searchResults.results[Number(button.dataset.index)];
      await navigate("source", item.source_id, {
        table: item.table_key,
        ...(item.column_name ? { column: item.column_name } : {}),
        ...(item.kind === "note" ? { section: "notes" } : {}),
      });
    }
    if (a === "close-modal") {
      modal.close();
      return;
    }
    if (a === "source-kind") {
      state.filter = button.dataset.kind;
      state.sourcePage = 1;
      paintSources();
    }
    if (a === "source-page") {
      state.sourcePage = Number(button.dataset.page);
      paintSources();
      document.querySelector(".source-list-scroll")?.scrollTo({ top: 0 });
    }
    if (a === "catalog-view") {
      state.catalogView = button.dataset.view;
      paintSources();
    }
    if (a === "reset-source-filters") resetSourceFilters();
    if (a === "source-sort") {
      if (state.sourceSort === button.dataset.sort)
        state.sourceSortDirection =
          state.sourceSortDirection === "asc" ? "desc" : "asc";
      else {
        state.sourceSort = button.dataset.sort;
        state.sourceSortDirection = ["scanned_at", "table_count"].includes(
          state.sourceSort,
        )
          ? "desc"
          : "asc";
      }
      state.sourcePage = 1;
      paintSources();
      document.querySelector(`[data-sort="${state.sourceSort}"]`)?.focus();
    }
    if (a === "source-sort-direction") {
      state.sourceSortDirection =
        state.sourceSortDirection === "asc" ? "desc" : "asc";
      state.sourcePage = 1;
      paintSources();
    }
    if (a === "nav") await navigate(button.dataset.view);
    if (a === "branding-name-default") {
      const input = document.getElementById("application-name");
      input.value = "DatabaseDoc";
      input.focus();
    }
    if (a === "branding-remove") await removeCompanyLogo();
    if (a === "open") await navigate("source", button.dataset.id);
    if (a === "add-source") sourceModal();
    if (a === "edit-source") sourceModal(true);
    if (a === "add-user") addUserModal();
    if (a === "edit-user") editUserModal(button.dataset.id);
    if (a === "grants") await grantsModal(button.dataset.id);
    if (a === "password") passwordModal();
    if (a === "logout") {
      await api("/api/auth/logout", "POST", {});
      finderReset();
      state.user = null;
      state.csrf = "";
      location.hash = "";
      await showLogin();
    }
    if (a === "scan") {
      button.disabled = true;
      await api(`/api/sources/${state.source.id}/scan`, "POST", {});
      await loadSources();
      state.source = state.sources.find((s) => s.id === state.source.id);
      renderSource();
      toast(uiText("Schema-Scan gestartet."));
    }
    if (a === "source-tab") await changeSourceTab(button.dataset.tab);
    if (a === "select-table") selectTable(Number(button.dataset.index));
    if (a === "table-tab") {
      state.tableTab = button.dataset.tab;
      document.getElementById("object-detail").innerHTML = tableDetail();
    }
    if (a === "load-preview") {
      button.disabled = true;
      button.textContent = uiText("Vorschau wird geladen …");
      const t = state.snapshot.payload.tables[state.table];
      const p = await api(`/api/sources/${state.source.id}/preview`, "POST", {
        table_key: t.key,
      });
      document.getElementById("preview-result").innerHTML =
        localize`<p class="muted small" style="margin-bottom:10px">${p.rows.length} Zeilen · maximal ${p.limit} · Reihenfolge der Datenquelle</p><div class="table-wrap"><table><thead><tr>${p.columns.map((c) => `<th>${e(c)}</th>`).join("")}</tr></thead><tbody>${p.rows.map((row) => `<tr>${row.map((v) => `<td class="mono">${v === null ? '<span class="muted">NULL</span>' : e(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      button.textContent = uiText("Vorschau aktualisieren");
      button.disabled = false;
    }
    if (a === "discover") {
      const form = document.getElementById("source-form"),
        id = form.dataset.id;
      button.disabled = true;
      const result = await api(
        id ? `/api/sources/${id}/discover` : "/api/sources/discover",
        "POST",
        sourceInput(),
      );
      document.getElementById("database-options").innerHTML = result.databases
        .map((n) => `<option value="${e(n)}"></option>`)
        .join("");
      if (
        result.databases.length &&
        !document.getElementById("f-database").value
      )
        document.getElementById("f-database").value = result.databases[0];
      toast(
        result.databases.length +
          " Datenbanken gefunden. Datenbankfeld öffnen, um auszuwählen.",
      );
      button.disabled = false;
    }
    if (a === "test-connection") {
      const form = document.getElementById("source-form"),
        id = form.dataset.id;
      button.disabled = true;
      document.getElementById("source-error").textContent = uiText(
        "Verbindung wird geprüft …",
      );
      const result = await api(
        id ? `/api/sources/${id}/test-config` : "/api/sources/test",
        "POST",
        sourceInput(),
      );
      document.getElementById("source-error").textContent = "";
      toast(result.message);
      button.disabled = false;
    }
    if (a === "delete-source") {
      openModal(
        uiText("Datenquelle löschen"),
        localize`<p>Die Verbindung „${e(state.source.name)}“ und ihre gespeicherte Dokumentation werden gelöscht.</p><p class="muted small" style="margin-top:10px">Die Quelldatenbank wird dabei nicht verändert.</p><div class="modal-footer"><button class="btn" data-action="close-modal">Abbrechen</button><button class="btn danger" data-action="confirm-delete-source">Endgültig löschen</button></div>`,
      );
    }
    if (a === "confirm-delete-source") {
      await api(`/api/sources/${state.source.id}`, "DELETE");
      modal.close();
      await navigate("sources");
      toast(uiText("Datenquelle gelöscht."));
    }
    if (a === "er-reset") {
      state.erPositions = {};
      diagramCameras.delete(state.erScope);
      setupER();
    }
    if (a === "er-download") downloadER();
    if (["pdf-tables", "pdf-table", "pdf-er"].includes(a)) {
      button.disabled = true;
      try {
        await downloadPdf(
          a === "pdf-er" ? "er_pdf" : "pdf",
          a === "pdf-table"
            ? state.snapshot.payload.tables[state.table].key
            : null,
        );
      } finally {
        button.disabled = false;
      }
    }
    if (a === "history-open") {
      state.snapshot = await api(
        `/api/sources/${state.source.id}/snapshot?snapshot_id=${button.dataset.id}`,
      );
      openModal(
        "Schema-Stand · " + dt(state.snapshot.created),
        localize`<p class="muted small" style="margin-bottom:16px">Historischer Schema-Stand. Datenvorschau und Notizen beziehen sich auf den aktuellen Stand.</p><div class="table-wrap"><table><thead><tr><th>Objekt</th><th>Spalten</th><th>Fremdschlüssel</th></tr></thead><tbody>${state.snapshot.payload.tables.map((t) => `<tr><td>${e(t.schema + "." + t.name)}</td><td>${t.columns.length}</td><td>${t.foreign_keys.length}</td></tr>`).join("")}</tbody></table></div>`,
      );
      state.snapshot = await api(`/api/sources/${state.source.id}/snapshot`);
    }
  } catch (error) {
    button.disabled = false;
    const errorNode = modal.open
      ? document.getElementById("source-error") ||
        document.getElementById("form-error")
      : null;
    if (errorNode) errorNode.textContent = error.message;
    else toast(error.message);
  }
});
document.addEventListener("submit", async (ev) => {
  const form = ev.target;
  if (form.id === "branding-name-form") {
    ev.preventDefault();
    await saveApplicationName(form);
    return;
  }
  if (form.id === "profile-form") {
    ev.preventDefault();
    await profileSubmit(form);
    return;
  }
  if (form.id.startsWith("df-")) {
    ev.preventDefault();
    await finderSubmit(form);
    return;
  }
  if (form.id.startsWith("an-")) {
    ev.preventDefault();
    await analysisSubmit(form);
    return;
  }
  if (form.id.startsWith("tool-")) {
    ev.preventDefault();
    await toolsSubmit(form);
    return;
  }
  if (form.id.startsWith("ct-")) {
    ev.preventDefault();
    await classificationSubmit(form);
    return;
  }
  if (form.id.startsWith("wh-")) {
    ev.preventDefault();
    await warehouseWorkspaceSubmit(form);
    return;
  }
  if (form.id.startsWith("dwh-")) {
    ev.preventDefault();
    await warehouseSubmit(form);
    return;
  }
  if (
    ![
      "login-form",
      "source-form",
      "user-form",
      "user-edit-form",
      "grants-form",
      "password-form",
      "note-form",
      "organization-form",
      "schedule-form",
      "comparison-form",
      "search-form",
      "branding-form",
    ].includes(form.id)
  )
    return;
  ev.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try {
    if (form.id === "branding-form") await saveCompanyLogo(form);
    if (form.id === "organization-form") {
      const result = await api(
        `/api/sources/${state.source.id}/metadata`,
        "PUT",
        {
          tags: data.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          owner: data.owner,
          owner_email: data.owner_email,
        },
      );
      Object.assign(state.source, result);
      await loadSources();
      renderSource();
      toast(uiText("Tags und Verantwortliche gespeichert."));
    }
    if (form.id === "schedule-form") {
      const [hour, minute] = data.time.split(":").map(Number);
      state.schedule = await api(
        `/api/sources/${state.source.id}/schedule`,
        "PUT",
        {
          enabled: data.enabled === "on",
          cadence: data.cadence,
          hour,
          minute,
          weekday: Number(data.weekday),
          timezone: data.timezone,
        },
      );
      state.source.schedule = state.schedule;
      await loadSources();
      renderSource();
      toast(uiText("Scan-Zeitplan gespeichert."));
    }
    if (form.id === "comparison-form") {
      state.compareBefore = Number(data.before);
      state.compareAfter = Number(data.after);
      state.comparison = null;
      await loadComparison();
      renderSource();
    }
    if (form.id === "search-form") {
      state.searchQuery = data.q;
      state.searchSource = data.source_id;
      state.searchKind = data.kind;
      state.searchPage = 1;
      await runSearch();
      history.replaceState(
        null,
        "",
        "#search?" + new URLSearchParams({ q: state.searchQuery }),
      );
    }
    if (form.id === "login-form") {
      const result = await api("/api/auth/login", "POST", data);
      state.user = result.user;
      state.csrf = result.csrf;
      if (profileNeedsReload(state.user)) {
        location.reload();
        return;
      }
      await loadSources();
      await route();
    }
    if (form.id === "source-form") {
      const id = form.dataset.id;
      const source = await api(
        id ? `/api/sources/${id}` : "/api/sources",
        id ? "PUT" : "POST",
        sourceInput(),
      );
      modal.close();
      await loadSources();
      await navigate("source", source.id);
      toast(uiText("Datenquelle gespeichert. Starte jetzt einen Schema-Scan."));
    }
    if (form.id === "user-form") {
      await api("/api/users", "POST", data);
      modal.close();
      await navigate("users");
      toast(uiText("Benutzer angelegt."));
    }
    if (form.id === "user-edit-form") {
      await api(`/api/users/${form.dataset.id}`, "PUT", {
        role: data.role,
        active: data.active === "on",
      });
      modal.close();
      await navigate("users");
      toast(uiText("Benutzer aktualisiert."));
    }
    if (form.id === "grants-form") {
      const id = form.dataset.id;
      for (const row of form.querySelectorAll("[data-user]")) {
        const uid = Number(row.dataset.user);
        if (data[`read-${uid}`] === "on")
          await api(`/api/sources/${id}/grants`, "PUT", {
            user_id: uid,
            edit: data[`edit-${uid}`] === "on",
            data: data[`data-${uid}`] === "on",
          });
        else await api(`/api/sources/${id}/grants/${uid}`, "DELETE");
      }
      modal.close();
      toast(uiText("Freigaben gespeichert."));
    }
    if (form.id === "password-form") {
      const result = await api("/api/auth/password", "POST", data);
      state.csrf = result.csrf;
      modal.close();
      toast(uiText("Passwort geändert."));
    }
    if (form.id === "note-form") {
      const t = state.snapshot.payload.tables[state.table];
      await api(`/api/sources/${state.source.id}/notes`, "PUT", {
        table_key: t.key,
        text: data.text,
      });
      state.snapshot.notes[t.key] = data.text;
      toast(uiText("Dokumentation gespeichert."));
    }
  } catch (error) {
    const node = document.getElementById(
      form.id === "login-form"
        ? "login-error"
        : form.id === "source-form"
          ? "source-error"
          : "form-error",
    );
    if (node) node.textContent = error.message;
    else toast(error.message);
  } finally {
    button.disabled = false;
  }
});
document.addEventListener("input", (ev) => {
  if (ev.target.id === "wh-discovery-query") whDiscoveryInput();
  finderInput(ev.target);
  analysisInput(ev.target);
  if (ev.target.id === "wa-object-query") {
    state.waObjectPage = 0;
    assessmentPaint();
  }
  if (ev.target.id === "tool-search") toolsFilter();
  warehouseWorkspaceSearch(ev.target);
  if (ev.target.id === "source-tags") classificationPreview();
  if (ev.target.closest("#ct-definition-form")) classificationUpdate();
  if (ev.target.id === "source-search") {
    state.query = ev.target.value;
    state.sourcePage = 1;
    paintSources();
  }
  if (ev.target.id === "object-search")
    document.getElementById("object-items").innerHTML = tableList(
      ev.target.value,
    );
});
document.addEventListener("change", (ev) => {
  finderChange(ev.target);
  analysisChange(ev.target);
  if (ev.target.id === "wa-severity") {
    state.waFindingPage = 0;
    assessmentPaint();
  }
  toolsChange(ev.target);
  warehouseWorkspaceChange(ev.target);
  if (ev.target.closest("#ct-definition-form, #ct-assignment-form"))
    classificationUpdate();
  if (ev.target.id.startsWith("dwh-") || ev.target.dataset.dwhStatus)
    warehouseChange(ev.target);
  const catalogFields = {
    "source-host-filter": "hostFilter",
    "source-tag-filter": "tagFilter",
    "source-category-filter": "tagCategoryFilter",
    "source-status-filter": "statusFilter",
    "source-sort": "sourceSort",
    "source-page-size": "sourcePageSize",
  };
  if (catalogFields[ev.target.id]) {
    state[catalogFields[ev.target.id]] =
      ev.target.id === "source-page-size"
        ? Number(ev.target.value)
        : ev.target.value;
    if (ev.target.id === "source-sort")
      state.sourceSortDirection = ["scanned_at", "table_count"].includes(
        state.sourceSort,
      )
        ? "desc"
        : "asc";
    state.sourcePage = 1;
    paintSources();
  }
  if (ev.target.id === "f-kind") sourceFormKind();
  if (ev.target.id === "company-logo-file") previewCompanyLogo(ev.target);
  if (ev.target.id === "schedule-cadence") updateScheduleFields();
});
modal.addEventListener("click", (ev) => {
  if (ev.target === modal) {
    const rect = modal.getBoundingClientRect();
    if (
      ev.clientX < rect.left ||
      ev.clientX > rect.right ||
      ev.clientY < rect.top ||
      ev.clientY > rect.bottom
    )
      modal.close();
  }
});
async function route() {
  const [path, query = ""] = location.hash.slice(1).split("?");
  const [view, id] = path.split("/");
  await navigate(
    [
      "tools",
      "tool-design",
      "sources",
      "source",
      "search",
      "analysis",
      "warehouse",
      "warehouse-project",
      "warehouse-workspace",
      "users",
      "audit",
      "settings",
      "profile",
      "branding",
    ].includes(view)
      ? view
      : "sources",
    id,
    Object.fromEntries(new URLSearchParams(query)),
  );
}
window.addEventListener("popstate", () => {
  if (state.user) route().catch((error) => toast(error.message));
});
let lastSourcePoll = 0;
setInterval(async () => {
  if (
    !state.user ||
    (!state.sources.some((s) =>
      ["queued", "running"].includes(s.job?.status),
    ) &&
      Date.now() - lastSourcePoll < 30000)
  )
    return;
  try {
    lastSourcePoll = Date.now();
    const old = JSON.stringify(state.sources.map((s) => s.job));
    await loadSources();
    if (
      old !== JSON.stringify(state.sources.map((s) => s.job)) &&
      !modal.open
    ) {
      if (state.view === "sources") {
        if (document.activeElement?.matches("input, select")) paintSources();
        else renderSources();
      } else if (
        state.view === "source" &&
        !["organization", "schedule", "compare"].includes(state.tab) &&
        !(state.tab === "schema" && state.tableTab === "notes") &&
        !document.activeElement?.matches("input, textarea, select")
      ) {
        // Keep a note's visible table and pending text together until the editor leaves it.
        const source = state.sources.find((s) => s.id === state.source.id);
        if (!source) return;
        state.source = source;
        if (source.snapshot_id && state.snapshot?.id !== source.snapshot_id)
          await refreshSnapshot();
        if (state.tab === "history")
          state.history = await api(`/api/sources/${source.id}/history`);
        renderSource();
      }
    }
  } catch (error) {
    toast(error.message);
  }
}, 4000);
(async () => {
  try {
    await loadBranding();
    const me = await api("/api/auth/me");
    state.user = me.user;
    state.csrf = me.csrf;
    if (profileNeedsReload(state.user)) {
      location.reload();
      return;
    }
    await loadSources();
    await route();
  } catch (error) {
    if (!state.user) await showLogin();
    else {
      root.innerHTML = localize`<div class="empty"><h2>Anwendung konnte nicht geladen werden</h2><p>${e(error.message)}</p><button class="btn" data-action="nav" data-view="sources">Erneut versuchen</button></div>`;
    }
  }
})();

function tagList(tags, source = {}) {
  return (tags || []).length
    ? `<span class="tag-list">${sortedTags(tags)
        .map((t) => tagBadge(t, source))
        .join("")}</span>`
    : localize('<span class="muted">Keine Tags</span>');
}
function organizationView() {
  const s = state.source;
  return localize`<section class="panel feature-panel"><div class="panel-head"><div><h2>Tags & Verantwortliche</h2><p class="muted small">Ordne diese Datenbank einem Team zu und finde sie mit Tags im Katalog.</p></div></div><div class="panel-body"><form id="organization-form" class="feature-form"><fieldset ${s.can_edit ? "" : "disabled"}><div class="field"><label for="source-tags">Tags</label><input id="source-tags" name="tags" value="${e(sortedTags(s.tags).join(", "))}" placeholder="Produktion, Finance, Data Warehouse"><small>Mit Kommas trennen. Bis zu 20 Tags mit jeweils 60 Zeichen.</small>${classificationEditorHints()}</div><div class="form-grid"><div class="field"><label for="source-owner">Verantwortliche Person oder Team</label><input id="source-owner" name="owner" maxlength="190" value="${e(s.owner)}" placeholder="Data Platform Team"></div><div class="field"><label for="source-owner-email">Kontakt-E-Mail</label><input id="source-owner-email" name="owner_email" type="email" maxlength="190" value="${e(s.owner_email)}" placeholder="data-team@example.org"></div></div>${s.can_edit ? localize('<button class="btn primary" type="submit">Zuständigkeit speichern</button>') : localize('<p class="muted">Du hast Leserechte für diese Angaben.</p>')}</fieldset><div id="form-error" class="error-text" role="alert"></div></form></div></section><div class="hint">${icon("info")}<span>Die Zuständigkeit dient der Dokumentation. Zugriffsrechte vergibt ein Administrator unter „Benutzer & Rechte“.</span></div>`;
}
function scheduleView() {
  const s = state.source,
    v = state.schedule ||
      s.schedule || {
        enabled: false,
        cadence: "daily",
        hour: 2,
        minute: 0,
        weekday: 0,
        timezone: "Europe/Berlin",
      };
  const time = `${String(v.hour).padStart(2, "0")}:${String(v.minute).padStart(2, "0")}`;
  return localize`<section class="panel feature-panel"><div class="panel-head"><div><h2>Automatische Schema-Scans</h2><p class="muted small">Halte die Dokumentation mit einem Zeitplan aktuell.</p></div><span class="badge ${v.enabled ? "" : "neutral"}">${v.enabled ? uiText("Aktiv") : uiText("Deaktiviert")}</span></div><div class="panel-body"><form id="schedule-form" class="feature-form"><fieldset ${s.can_edit ? "" : "disabled"}><label class="check-line"><input type="checkbox" name="enabled" ${v.enabled ? "checked" : ""}> Automatische Scans aktivieren</label><div class="form-grid"><div class="field"><label for="schedule-cadence">Intervall</label><select id="schedule-cadence" name="cadence">${Object.entries(
    {
      hourly: uiText("Stündlich"),
      daily: uiText("Täglich"),
      weekly: uiText("Wöchentlich"),
    },
  )
    .map(
      ([id, label]) =>
        `<option value="${id}" ${id === v.cadence ? "selected" : ""}>${label}</option>`,
    )
    .join(
      "",
    )}</select></div><div class="field" id="schedule-time-field" ${v.cadence === "hourly" ? "hidden" : ""}><label for="schedule-time">Uhrzeit</label><input id="schedule-time" name="time" type="time" required value="${time}"></div><div class="field" id="schedule-weekday-field" ${v.cadence !== "weekly" ? "hidden" : ""}><label for="schedule-weekday">Wochentag</label><select id="schedule-weekday" name="weekday">${[uiText("Montag"), uiText("Dienstag"), uiText("Mittwoch"), uiText("Donnerstag"), uiText("Freitag"), uiText("Samstag"), uiText("Sonntag")].map((label, i) => `<option value="${i}" ${i === v.weekday ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="field"><label for="schedule-timezone">Zeitzone</label><input id="schedule-timezone" name="timezone" maxlength="64" required value="${e(v.timezone)}" list="timezones"><datalist id="timezones"><option value="Europe/Berlin"><option value="UTC"><option value="Europe/London"><option value="America/New_York"></datalist></div></div><p class="muted small">Stündliche Scans beginnen eine Stunde nach dem Speichern. Tägliche und wöchentliche Termine folgen der gewählten Ortszeit.</p>${s.can_edit ? localize('<button class="btn primary" type="submit">Zeitplan speichern</button>') : localize('<p class="muted">Nur Bearbeiter können diesen Zeitplan ändern.</p>')}</fieldset><div id="form-error" class="error-text" role="alert"></div></form><div class="schedule-summary">${info(uiText("Nächster Termin"), v.next_run ? e(scheduleDate(v.next_run, v.timezone)) : uiText("Kein Termin geplant"))}${info(uiText("Letzter automatischer Start"), v.last_started ? e(dt(v.last_started)) : uiText("Noch keiner"))}${v.message ? info("Status", e(uiMessage(v.message))) : ""}</div></div></section><div class="hint">${icon("info")}<span>Der Planer prüft Termine alle 30 Sekunden und verhindert parallele Scans derselben Quelle. Nach einer Auszeit wird ein verpasster Termin nachgeholt. Das einrichtende Konto muss aktiv bleiben und Bearbeitungsrechte behalten.</span></div>`;
}
function scheduleDate(value, zone) {
  return (
    new Date(value.endsWith("Z") ? value : value + "Z").toLocaleString(
      uiLocale,
      { timeZone: zone, dateStyle: "medium", timeStyle: "short" },
    ) +
    " · " +
    zone
  );
}
function updateScheduleFields() {
  const cadence = document.getElementById("schedule-cadence").value;
  document.getElementById("schedule-time-field").hidden = cadence === "hourly";
  document.getElementById("schedule-weekday-field").hidden =
    cadence !== "weekly";
}
async function loadComparison() {
  state.comparison = await api(
    `/api/sources/${state.source.id}/compare?` +
      new URLSearchParams({
        before: state.compareBefore,
        after: state.compareAfter,
      }),
  );
}
const diffLabels = {
  type: uiText("Datentyp"),
  nullable: "NULL erlaubt",
  default: uiText("Standardwert"),
  primary_key: uiText("Primärschlüssel"),
  comment: uiText("Kommentar"),
  kind: uiText("Objekttyp"),
  foreign_keys: uiText("Fremdschlüssel"),
  indexes: uiText("Indizes"),
  unique_constraints: uiText("Eindeutige Constraints"),
  validator: uiText("MongoDB-Validator"),
};
function diffValue(value) {
  return value === null || value === undefined
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value, null, 2)
      : typeof value === "boolean"
        ? value
          ? uiText("Ja")
          : uiText("Nein")
        : String(value);
}
function diffChanges(changes) {
  return localize`<div class="table-wrap"><table class="diff-table"><thead><tr><th>Eigenschaft</th><th>Vorher</th><th>Nachher</th></tr></thead><tbody>${Object.entries(
    changes,
  )
    .map(
      ([field, delta]) =>
        `<tr><td>${e(diffLabels[field] || field)}</td><td><pre>${e(diffValue(delta.before))}</pre></td><td><pre>${e(diffValue(delta.after))}</pre></td></tr>`,
    )
    .join("")}</tbody></table></div>`;
}
function columnChanges(columns, label, css) {
  return columns.length
    ? `<div class="diff-columns"><strong class="${css}">${label}</strong> ${columns.map((c) => `<span class="tag">${e(c.name)} · ${e(c.type)}</span>`).join(" ")}</div>`
    : "";
}
function comparisonView() {
  if (state.history.length < 2)
    return localize`<div class="empty">${icon("relations")}<h2>Zwei Schema-Stände benötigt</h2><p>Nach zwei erfolgreichen Scans kannst du Änderungen an Tabellen, Spalten, Schlüsseln und Indizes vergleichen.</p></div>`;
  const options = (selected) =>
    state.history
      .map(
        (h) =>
          localize`<option value="${h.id}" ${h.id === selected ? "selected" : ""}>#${h.id} · ${e(dt(h.created))} · ${h.table_count} Objekte</option>`,
      )
      .join("");
  const d = state.comparison;
  return localize`<section class="panel"><div class="panel-head"><div><h2>Schema-Stände vergleichen</h2><p class="muted small">Wähle einen älteren Ausgangsstand und einen neueren Vergleichsstand.</p></div></div><div class="panel-body"><form id="comparison-form" class="comparison-form"><div class="field"><label for="compare-before">Vorher</label><select id="compare-before" name="before">${options(state.compareBefore)}</select></div><div class="field"><label for="compare-after">Nachher</label><select id="compare-after" name="after">${options(state.compareAfter)}</select></div><button type="submit" class="btn primary">Vergleichen</button><div id="form-error" class="error-text" role="alert"></div></form></div></section>${
    d
      ? localize`<div class="diff-summary"><div><strong>${d.summary.added_tables}</strong><span>Objekte hinzugefügt</span></div><div><strong>${d.summary.removed_tables}</strong><span>Objekte entfernt</span></div><div><strong>${d.summary.changed_tables}</strong><span>Objekte geändert</span></div><div><strong>${d.summary.added_columns + d.summary.removed_columns + d.summary.changed_columns}</strong><span>Spaltenänderungen</span></div></div>${!d.added_tables.length && !d.removed_tables.length && !d.changed_tables.length ? localize('<section class="panel panel-body"><h3>Keine Schema-Änderungen</h3><p class="muted">Die dokumentierten Strukturen stimmen überein.</p></section>') : ""}${[
          [d.added_tables, uiText("Objekt hinzugefügt"), "diff-added"],
          [d.removed_tables, uiText("Objekt entfernt"), "diff-removed"],
        ]
          .map(([items, label, css]) =>
            items
              .map(
                (t) =>
                  `<details class="panel diff-object" open><summary><span class="${css}">${label}</span> ${e([t.schema, t.name].filter(Boolean).join("."))}</summary><div class="panel-body">${columnChanges(t.columns, uiText("Spalten"), css)}</div></details>`,
              )
              .join(""),
          )
          .join(
            "",
          )}${d.changed_tables.map((t) => localize`<details class="panel diff-object" open><summary><span class="diff-changed">Objekt geändert</span> ${e([t.schema, t.name].filter(Boolean).join("."))}</summary><div class="panel-body">${columnChanges(t.added_columns, uiText("Spalten hinzugefügt"), "diff-added")}${columnChanges(t.removed_columns, uiText("Spalten entfernt"), "diff-removed")}${t.changed_columns.map((c) => localize`<h3 class="diff-column-title">Spalte ${e(c.name)}</h3>${diffChanges(c.changes)}`).join("")}${Object.keys(t.changes).length ? localize`<h3 class="diff-column-title">Objekt-Eigenschaften</h3>${diffChanges(t.changes)}` : ""}</div></details>`).join("")}${d.inferred ? localize('<div class="hint">Abgeleitete MongoDB-Felder beruhen auf Stichproben. Unterschiede können durch die untersuchten Dokumente entstehen.</div>') : ""}`
      : ""
  }<div class="hint">${icon("info")}<span>Der Vergleich verwendet gespeicherte Metadaten. Umbenennungen werden als Entfernen und Hinzufügen angezeigt. Notizen und Datenwerte gehören nicht zum Schema-Vergleich.</span></div>`;
}
async function runSearch() {
  const params = new URLSearchParams({
    q: state.searchQuery,
    kind: state.searchKind,
    page: state.searchPage,
    page_size: 50,
  });
  if (state.searchSource !== "all") params.set("source_id", state.searchSource);
  state.searchResults = await api("/api/search?" + params);
  renderSearch();
}
function renderSearch() {
  if (state.searchMode === "finder") return renderFinder();
  const data = state.searchResults,
    labels = {
      table: uiText("Tabelle / Collection"),
      column: uiText("Spalte / Feld"),
      note: uiText("Dokumentation"),
    };
  shell(
    localize`<div class="page-head"><div><div class="eyebrow">Datenbankübergreifend</div><h1>Globale Suche</h1><p>Finde Tabellen, Spalten, Kommentare und Notizen in deinen freigegebenen Datenbanken.</p></div></div>${searchModes()}<section class="panel"><div class="panel-body"><form id="search-form" class="global-search-form"><div class="field"><label for="global-search-q">Suchbegriff</label><input id="global-search-q" name="q" minlength="2" maxlength="200" required placeholder="Zum Beispiel customer_id oder Bestellungen …" value="${e(state.searchQuery)}"></div><div class="field"><label for="global-search-source">Datenquelle</label><select id="global-search-source" name="source_id"><option value="all">Alle freigegebenen Quellen</option>${state.sources.map((s) => `<option value="${s.id}" ${String(s.id) === String(state.searchSource) ? "selected" : ""}>${e(s.name)}</option>`).join("")}</select></div><div class="field"><label for="global-search-kind">Treffertyp</label><select id="global-search-kind" name="kind"><option value="all">Alle Typen</option>${Object.entries(
      labels,
    )
      .map(
        ([id, label]) =>
          `<option value="${id}" ${id === state.searchKind ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></div><button class="btn primary" type="submit">${icon("search")} Suchen</button><div id="form-error" class="error-text" role="alert"></div></form></div></section>${data ? localize`<section class="panel search-results"><div class="panel-head"><h2>${data.total.toLocaleString(uiLocale)} Treffer</h2><span class="muted small">Aktuelle Schema-Stände</span></div>${data.results.length ? data.results.map((item, i) => localize`<article class="search-result"><div class="db-icon ${e(item.source_kind)}">${databaseLogo(item.source_kind)}</div><div><div class="small muted">${e(item.source_name)} · ${labels[item.kind]}</div><button class="source-title" data-action="search-open" data-index="${i}">${e(item.title)}</button><p>${e(item.snippet)}</p></div><button class="btn ghost" data-action="search-open" data-index="${i}" aria-label="${e(item.title)} öffnen">${icon("arrow")}</button></article>`).join("") : localize('<div class="empty"><h2>Keine Treffer</h2><p>Versuche einen anderen Begriff oder lockere die Filter. Quellen benötigen einen erfolgreichen Scan.</p></div>')}<div class="catalog-pagination"><span class="muted small">Seite ${data.page} von ${Math.max(1, Math.ceil(data.total / data.page_size))}</span><div class="page-buttons"><button class="btn" data-action="search-page" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>${icon("back")} Zurück</button><button class="btn" data-action="search-page" data-page="${data.page + 1}" ${data.page * data.page_size >= data.total ? "disabled" : ""}>Weiter ${icon("arrow")}</button></div></div></section>` : localize('<div class="empty"><h2>Wissen in allen Datenbanken finden</h2><p>Gib mindestens zwei Zeichen ein. Mehrere Wörter müssen gemeinsam im Treffer vorkommen.</p></div>')}<div class="hint">${icon("shield")}<span>Gesucht wird in dokumentierten Metadaten und Notizen. Datenvorschauen und Zugangsdaten sind nicht Teil der Suche.</span></div>`,
  );
}
