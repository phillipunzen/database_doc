"use strict";
const diagramControllers = new Set(),
  diagramCameras = new Map();
let diagramSequence = 0;
function diagramCleanup() {
  for (const controller of diagramControllers) controller.destroy();
  diagramControllers.clear();
}
function diagramToolbar(source = false) {
  const id = source ? "er-zoom" : `diagram-zoom-${++diagramSequence}`;
  return `<div class="diagram-toolbar"><div class="diagram-zoom-tools"><button class="btn" type="button" data-diagram-command="out" aria-label="${e(uiText("Verkleinern"))}">−</button><label class="sr-only" for="${id}">${e(uiText("Zoom"))}</label><input id="${id}" data-diagram-zoom type="range" min="0.01" max="4" step="0.01" value="1"><output data-diagram-percent aria-live="off">100%</output><button class="btn" type="button" data-diagram-command="in" aria-label="${e(uiText("Vergrößern"))}">+</button><button class="btn" type="button" data-diagram-command="fit">${e(uiText("Alles einpassen"))}</button><button class="btn" type="button" data-diagram-command="actual">100%</button><button class="btn" type="button" data-diagram-command="neighbors" disabled>${e(uiText("Tabelle & Nachbarn"))}</button><button class="btn" type="button" data-diagram-command="fullscreen">${e(uiText("Vollbild"))}</button>${source ? `<button class="btn" type="button" data-action="er-reset">${e(uiText("Neu anordnen"))}</button><button class="btn" type="button" data-action="er-download">SVG</button><button class="btn" type="button" data-action="pdf-er">PDF</button>` : ""}</div><div class="diagram-search"><label class="sr-only" for="${id}-search">${e(uiText("Tabelle im Diagramm suchen"))}</label><input id="${id}-search" data-diagram-search type="search" autocomplete="off" placeholder="${e(uiText("Tabelle im Diagramm suchen …"))}"><div data-diagram-results class="diagram-search-results" hidden></div></div></div>`;
}
function diagramMiniMap() {
  return `<svg class="diagram-minimap" role="group" aria-label="${e(uiText("Minikarte: klicken, um die Ansicht zu verschieben"))}"><g data-diagram-mini-nodes></g><rect class="diagram-mini-viewport" fill="none" stroke="#276256" stroke-width="2" vector-effect="non-scaling-stroke"></rect></svg>`;
}
function diagramHelp(source = false) {
  return `<div class="er-footer">${e(uiText("Mausrad: zoomen · Hintergrund ziehen: verschieben · Zwei Finger: zoomen und verschieben · Pfeiltasten: verschieben · +/−: zoomen · Home: Gesamtansicht"))}${source ? `<br>${e(uiText("Tabellen mit der Maus ziehen; mit Leertaste oder mittlerer Maustaste die Ansicht verschieben. Doppelklick oder Enter öffnet Details."))}` : ""}</div>`;
}
function diagramNavigator(svg, nodes, options = {}) {
  const explorer = svg.closest(".diagram-explorer"),
    stage = svg.parentElement,
    mini = explorer.querySelector(".diagram-minimap"),
    search = explorer.querySelector("[data-diagram-search]"),
    results = explorer.querySelector("[data-diagram-results]");
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const scope = options.scope,
    initial = diagramCameras.get(scope);
  let box = initial ? { ...initial } : null,
    zoom = 1,
    size = { width: 0, height: 0 },
    selected = null,
    frame = 0,
    drag = null,
    gesture = null,
    space = false,
    suppressClick = false,
    moved = false;
  const pointers = new Map(),
    abort = new AbortController(),
    signal = abort.signal;
  function dimensions() {
    const r = svg.getBoundingClientRect();
    return { width: Math.max(1, r.width), height: Math.max(1, r.height) };
  }
  function bounds(items = nodes) {
    if (!items.length) return { x: 0, y: 0, width: 300, height: 200 };
    const x = Math.min(...items.map((n) => n.x)) - 55,
      y = Math.min(...items.map((n) => n.y)) - 55;
    return {
      x,
      y,
      width: Math.max(...items.map((n) => n.x + n.width)) - x + 85,
      height: Math.max(...items.map((n) => n.y + n.height)) - y + 55,
    };
  }
  function world(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return {
      x: box.x + ((clientX - r.left) * box.width) / r.width,
      y: box.y + ((clientY - r.top) * box.height) / r.height,
    };
  }
  function refresh() {
    if (!box) return;
    zoom = size.width / box.width;
    svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
    svg.setAttribute("preserveAspectRatio", "none");
    explorer.querySelector("[data-diagram-percent]").textContent =
      new Intl.NumberFormat(uiLocale, {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(zoom);
    explorer.querySelector("[data-diagram-zoom]").value = zoom;
    options.onCamera?.(box, zoom);
    if (scope) {
      diagramCameras.delete(scope);
      diagramCameras.set(scope, { ...box });
      if (diagramCameras.size > 20)
        diagramCameras.delete(diagramCameras.keys().next().value);
    }
    const b = bounds();
    mini.setAttribute("viewBox", `${b.x} ${b.y} ${b.width} ${b.height}`);
    const viewport = mini.querySelector(".diagram-mini-viewport");
    for (const [key, value] of Object.entries({
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    }))
      viewport.setAttribute(key, value);
  }
  function schedule() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        refresh();
      });
  }
  function fit(items = nodes) {
    const b = bounds(items);
    size = dimensions();
    const scale = Math.max(
      0.01,
      Math.min(1, size.width / b.width, size.height / b.height),
    );
    box = {
      x: b.x + b.width / 2 - size.width / scale / 2,
      y: b.y + b.height / 2 - size.height / scale / 2,
      width: size.width / scale,
      height: size.height / scale,
    };
    refresh();
  }
  function zoomAt(scale, clientX, clientY) {
    scale = Math.max(0.01, Math.min(4, scale));
    const r = svg.getBoundingClientRect(),
      px = clientX ?? r.left + r.width / 2,
      py = clientY ?? r.top + r.height / 2,
      anchor = world(px, py);
    box = {
      x: anchor.x - (px - r.left) / scale,
      y: anchor.y - (py - r.top) / scale,
      width: size.width / scale,
      height: size.height / scale,
    };
    refresh();
  }
  function highlight(id) {
    selected = id;
    const node = byId.get(id),
      related = new Set([id, ...(node?.neighbors || [])]);
    for (const item of nodes) {
      item.element.classList.toggle("diagram-selected", item.id === id);
      item.element.classList.toggle(
        "diagram-dimmed",
        !!id && !related.has(item.id),
      );
      item.element.setAttribute(
        "tabindex",
        item.id === (id || nodes[0]?.id) ? "0" : "-1",
      );
    }
    for (const edge of svg.querySelectorAll("[data-edge-source]")) {
      edge.classList.toggle(
        "diagram-edge-active",
        !!id &&
          (edge.dataset.edgeSource === id || edge.dataset.edgeTarget === id),
      );
      edge.classList.toggle(
        "diagram-dimmed",
        !!id &&
          edge.dataset.edgeSource !== id &&
          edge.dataset.edgeTarget !== id,
      );
    }
    explorer.querySelector('[data-diagram-command="neighbors"]').disabled =
      !node;
  }
  function focus(id) {
    const node = byId.get(id);
    if (!node) return;
    highlight(id);
    const scale = Math.min(
      1.25,
      Math.max(0.4, size.width / (node.width + 150)),
    );
    box = {
      x: node.x + node.width / 2 - size.width / scale / 2,
      y: node.y + node.height / 2 - size.height / scale / 2,
      width: size.width / scale,
      height: size.height / scale,
    };
    refresh();
    node.element.focus({ preventScroll: true });
    results.hidden = true;
  }
  function renderMiniNodes() {
    mini.querySelector("[data-diagram-mini-nodes]").innerHTML = nodes
      .map(
        (n) =>
          `<rect x="${n.x}" y="${n.y}" width="${n.width}" height="${n.height}" fill="#abc8b0" stroke="#729880" stroke-width="1"/>`,
      )
      .join("");
  }
  function resize() {
    if (!svg.isConnected) return;
    const next = dimensions();
    if (!box) {
      size = next;
      fit();
      return;
    }
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 },
      scale = size.width / box.width;
    size = next;
    box = {
      x: center.x - size.width / scale / 2,
      y: center.y - size.height / scale / 2,
      width: size.width / scale,
      height: size.height / scale,
    };
    refresh();
  }
  function newDrag(event) {
    const node = byId.get(event.target.closest("[data-nav-id]")?.dataset.navId),
      p = world(event.clientX, event.clientY);
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...box },
      hitId: event.button === 0 && !space ? node?.id : undefined,
      node:
        event.pointerType !== "touch" &&
        !space &&
        event.button === 0 &&
        options.moveNode
          ? node
          : null,
      offset: node ? { x: p.x - node.x, y: p.y - node.y } : null,
    };
  }
  function startGesture() {
    const [a, b] = [...pointers.values()],
      mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    gesture = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      scale: size.width / box.width,
      anchor: world(mid.x, mid.y),
    };
    drag = null;
    moved = true;
    suppressClick = true;
  }
  svg.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      svg.focus({ preventScroll: true });
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      svg.setPointerCapture(event.pointerId);
      if (pointers.size === 2) {
        startGesture();
        return;
      }
      if (pointers.size > 2) return;
      moved = false;
      newDrag(event);
      const node = event.target.closest("[data-nav-id]");
      if (node && event.button === 0 && !space) highlight(node.dataset.navId);
      stage.classList.add("diagram-dragging");
    },
    { signal },
  );
  svg.addEventListener(
    "pointermove",
    (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture && pointers.size >= 2) {
        const [a, b] = [...pointers.values()],
          r = svg.getBoundingClientRect(),
          scale = Math.max(
            0.01,
            Math.min(
              4,
              (gesture.scale * Math.hypot(a.x - b.x, a.y - b.y)) /
                gesture.distance,
            ),
          );
        box = {
          x: gesture.anchor.x - ((a.x + b.x) / 2 - r.left) / scale,
          y: gesture.anchor.y - ((a.y + b.y) / 2 - r.top) / scale,
          width: size.width / scale,
          height: size.height / scale,
        };
        schedule();
        return;
      }
      if (!drag || drag.id !== event.pointerId) return;
      if (
        Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4
      )
        moved = true;
      if (drag.node) {
        const p = world(event.clientX, event.clientY);
        drag.node.x = p.x - drag.offset.x;
        drag.node.y = p.y - drag.offset.y;
        options.moveNode(drag.node.id, { x: drag.node.x, y: drag.node.y });
        drag.node.miniElement.setAttribute("x", drag.node.x);
        drag.node.miniElement.setAttribute("y", drag.node.y);
      } else {
        box = {
          ...drag.origin,
          x:
            drag.origin.x -
            ((event.clientX - drag.startX) * drag.origin.width) / size.width,
          y:
            drag.origin.y -
            ((event.clientY - drag.startY) * drag.origin.height) / size.height,
        };
      }
      schedule();
    },
    { signal },
  );
  function endPointer(event) {
    if (!pointers.has(event.pointerId)) return;
    const wasGesture = !!gesture,
      clicked = drag?.hitId;
    pointers.delete(event.pointerId);
    gesture = null;
    suppressClick = moved || wasGesture;
    drag = null;
    stage.classList.remove("diagram-dragging");
    if (pointers.size === 1) {
      const [id, p] = [...pointers.entries()][0];
      drag = { id, startX: p.x, startY: p.y, origin: { ...box }, node: null };
    }
    if (event.type === "pointercancel") suppressClick = true;
    highlight(selected);
    refresh();
    if (
      event.type === "pointerup" &&
      !moved &&
      !wasGesture &&
      clicked &&
      options.clickNode
    ) {
      suppressClick = false;
      options.clickNode(clicked);
      suppressClick = true;
    }
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    svg.addEventListener(type, endPointer, { signal });
  svg.addEventListener(
    "click",
    (event) => {
      if (suppressClick) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick = false;
      }
    },
    { signal, capture: true },
  );
  svg.addEventListener(
    "dblclick",
    (event) => {
      const node = event.target.closest("[data-nav-id]");
      if (node && options.openNode) {
        event.preventDefault();
        options.openNode(node.dataset.navId);
      }
    },
    { signal },
  );
  svg.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      if (event.shiftKey) {
        box.x += event.deltaX / zoom;
        box.y += event.deltaY / zoom;
        schedule();
      } else
        zoomAt(
          (size.width / box.width) *
            Math.exp(
              -Math.max(
                -300,
                Math.min(300, event.deltaY * (event.deltaMode === 1 ? 16 : 1)),
              ) * 0.0025,
            ),
          event.clientX,
          event.clientY,
        );
    },
    { signal, passive: false },
  );
  svg.addEventListener(
    "keydown",
    (event) => {
      if (event.key === " ") {
        space = true;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
      ) {
        event.preventDefault();
        box.x += ({ ArrowLeft: -80, ArrowRight: 80 }[event.key] || 0) / zoom;
        box.y += ({ ArrowUp: -80, ArrowDown: 80 }[event.key] || 0) / zoom;
        refresh();
      }
      if (["+", "=", "-", "_"].includes(event.key)) {
        event.preventDefault();
        zoomAt(zoom * (["-", "_"].includes(event.key) ? 1 / 1.25 : 1.25));
      }
      if (event.key === "Home") {
        event.preventDefault();
        fit();
      }
      if (event.key === "Escape") {
        highlight(null);
        results.hidden = true;
      }
      if (event.key === "Enter" && options.openNode) {
        const id =
          event.target.closest("[data-nav-id]")?.dataset.navId || selected;
        if (id) {
          event.preventDefault();
          event.stopPropagation();
          options.openNode(id);
        }
      }
    },
    { signal },
  );
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === " " &&
        !event.target.closest("input, textarea, select, [contenteditable]")
      ) {
        space = true;
        if (stage.matches(":hover") || svg.contains(document.activeElement))
          event.preventDefault();
      }
    },
    { signal },
  );
  window.addEventListener(
    "keyup",
    (event) => {
      if (event.key === " ") space = false;
    },
    { signal },
  );
  window.addEventListener(
    "blur",
    () => {
      space = false;
      pointers.clear();
      drag = null;
      gesture = null;
      stage.classList.remove("diagram-dragging");
    },
    { signal },
  );
  explorer.addEventListener(
    "click",
    async (event) => {
      const focusButton = event.target.closest("[data-diagram-focus]");
      if (focusButton) {
        focus(focusButton.dataset.diagramFocus);
        return;
      }
      const command = event.target.closest("[data-diagram-command]")?.dataset
        .diagramCommand;
      if (!command) return;
      if (command === "in" || command === "out")
        zoomAt(zoom * (command === "in" ? 1.25 : 1 / 1.25));
      if (command === "actual") zoomAt(1);
      if (command === "fit") {
        highlight(null);
        fit();
      }
      if (command === "neighbors") {
        const node = byId.get(selected);
        if (node)
          fit([
            node,
            ...[...node.neighbors].map((id) => byId.get(id)).filter(Boolean),
          ]);
      }
      if (command === "fullscreen") {
        try {
          if (document.fullscreenElement === explorer)
            await document.exitFullscreen();
          else await explorer.requestFullscreen();
        } catch {
          toast(uiText("Vollbild ist in diesem Browser nicht verfügbar."));
        }
      }
    },
    { signal },
  );
  explorer
    .querySelector("[data-diagram-zoom]")
    .addEventListener("input", (event) => zoomAt(Number(event.target.value)), {
      signal,
    });
  search.addEventListener(
    "input",
    () => {
      const query = search.value.trim().toLocaleLowerCase(uiLocale),
        matches = nodes.filter((n) =>
          n.label.toLocaleLowerCase(uiLocale).includes(query),
        );
      results.hidden = !query;
      results.innerHTML =
        matches
          .slice(0, 15)
          .map(
            (n) =>
              `<button type="button" data-diagram-focus="${e(n.id)}">${e(n.label)}</button>`,
          )
          .join("") +
        `<div class="small muted">${e(uiText("{0} von {1} Treffern", Math.min(15, matches.length), matches.length))}</div>`;
    },
    { signal },
  );
  search.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") {
        results.hidden = true;
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const first = results.querySelector("[data-diagram-focus]");
        if (first) focus(first.dataset.diagramFocus);
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        results.querySelector("button")?.focus();
      }
    },
    { signal },
  );
  results.addEventListener(
    "keydown",
    (event) => {
      const buttons = [...results.querySelectorAll("button")],
        index = buttons.indexOf(event.target);
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        buttons[
          Math.max(
            0,
            Math.min(
              buttons.length - 1,
              index + (event.key === "ArrowDown" ? 1 : -1),
            ),
          )
        ]?.focus();
      }
      if (event.key === "Escape") {
        results.hidden = true;
        search.focus();
      }
    },
    { signal },
  );
  mini.addEventListener(
    "pointerdown",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(
        mini.getScreenCTM().inverse(),
      );
      box.x = p.x - box.width / 2;
      box.y = p.y - box.height / 2;
      refresh();
    },
    { signal },
  );
  document.addEventListener(
    "fullscreenchange",
    () => {
      explorer.querySelector(
        '[data-diagram-command="fullscreen"]',
      ).textContent = uiText(
        document.fullscreenElement === explorer
          ? "Vollbild beenden"
          : "Vollbild",
      );
      resize();
    },
    { signal },
  );
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  renderMiniNodes();
  [...mini.querySelectorAll("[data-diagram-mini-nodes] rect")].forEach(
    (element, i) => (nodes[i].miniElement = element),
  );
  svg.setAttribute("tabindex", "0");
  highlight(null);
  size = dimensions();
  if (box) {
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    box = {
      ...box,
      height: (box.width * size.height) / size.width,
      x: center.x - box.width / 2,
      y: center.y - (box.width * size.height) / size.width / 2,
    };
    refresh();
  } else fit();
  const controller = {
    fit,
    focus,
    bounds,
    refresh,
    resize,
    get box() {
      return { ...box };
    },
    destroy() {
      abort.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
      diagramControllers.delete(controller);
    },
  };
  diagramControllers.add(controller);
  svg.diagramNavigation = controller;
  return controller;
}
function setupPlannedDiagrams() {
  for (const svg of document.querySelectorAll(
    ".dwh-diagram > svg:not(.diagram-minimap)",
  )) {
    if (svg.diagramNavigation) continue;
    const project =
      state.view === "tool-design" ? state.toolDesign : state.dwhProject;
    const stage = svg.parentElement;
    stage.classList.add("diagram-stage");
    const explorer = document.createElement("div");
    explorer.className = "diagram-explorer";
    stage.before(explorer);
    explorer.innerHTML = diagramToolbar();
    explorer.append(stage);
    stage.insertAdjacentHTML("beforeend", diagramMiniMap());
    explorer.insertAdjacentHTML("beforeend", diagramHelp());
    const nodes = [...svg.querySelectorAll(".dwh-diagram-node")].map(
      (element) => {
        element.dataset.navId = element.dataset.id;
        const r = element.querySelector("rect");
        return {
          id: element.dataset.id,
          label:
            project.tables.find((t) => t.id === element.dataset.id)?.name || "",
          x: Number(r.getAttribute("x")),
          y: Number(r.getAttribute("y")),
          width: 280,
          height: 140,
          element,
          neighbors: new Set(),
        };
      },
    );
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const edge of svg.querySelectorAll("[data-edge-source]")) {
      byId.get(edge.dataset.edgeSource)?.neighbors.add(edge.dataset.edgeTarget);
      byId.get(edge.dataset.edgeTarget)?.neighbors.add(edge.dataset.edgeSource);
    }
    svg.removeAttribute("width");
    svg.removeAttribute("height");
    svg.setAttribute("role", "group");
    diagramNavigator(svg, nodes, {
      scope: `${state.view === "tool-design" ? "tools" : "dwh"}:${project.id}:${nodes.map((n) => n.id).join(",")}`,
      clickNode: (id) =>
        byId
          .get(id)
          ?.element.dispatchEvent(new MouseEvent("click", { bubbles: true })),
      openNode: (id) =>
        byId
          .get(id)
          ?.element.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    });
  }
}
