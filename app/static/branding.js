async function loadBranding() {
  state.branding = await api("/api/branding");
  updateApplicationTitle();
}

function applicationName() {
  return state.branding?.app_name || "DatabaseDoc";
}

function updateApplicationTitle() {
  document.title = uiText("{0} · Datenbankdokumentation", applicationName());
}

function renderBranding() {
  const logo = state.branding?.logo_url;
  shell(localize`<div class="page-head"><div><div class="eyebrow">Administration</div><h1>Systemeinstellungen</h1><p>Gemeinsame Einstellungen für eure Installation.</p></div></div>
    <section class="panel branding-panel" aria-labelledby="application-name-title"><div class="panel-head"><h2 id="application-name-title">Anwendungsname</h2></div><div class="panel-body"><form id="branding-name-form">
      <div class="field"><label for="application-name">Name der Anwendung</label><input id="application-name" name="app_name" value="${e(applicationName())}" maxlength="80" required aria-describedby="application-name-help"><small id="application-name-help">Der Name erscheint in der Seitenleiste, auf der Anmeldung und im Browser-Titel. Er gilt für alle Benutzer. Maximal 80 Zeichen.</small></div>
      <div id="branding-name-error" class="error-text" role="alert"></div><div class="actions"><button type="submit" class="btn primary">Namen speichern</button><button type="button" class="btn" data-action="branding-name-default">Standard verwenden</button></div><p class="small muted">Standard: DatabaseDoc. Änderungen werden erst beim Speichern übernommen.</p>
    </form></div></section>
    <section class="panel branding-panel" aria-labelledby="company-logo-title"><div class="panel-head"><h2 id="company-logo-title">Firmenlogo</h2></div><div class="panel-body"><form id="branding-form">
      <h3>Logo-Vorschau</h3><div class="branding-preview" id="branding-preview">${logo ? `<img src="${e(logo)}" alt="${e(uiText("Firmenlogo"))}">` : `<p class="muted">${e(uiText("Kein Firmenlogo hinterlegt."))}</p>`}</div>
      <p class="muted">Das Logo erscheint auf der Anmeldung, in der Seitenleiste und in Tabellen- und ER-PDFs. Es gilt für alle Benutzer.</p>
      <div class="field"><label for="company-logo-file">Logo auswählen</label><input id="company-logo-file" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required aria-describedby="company-logo-help"><small id="company-logo-help">PNG, JPEG oder WebP, maximal 2 MB. Transparente PNGs eignen sich besonders gut. Das Logo wird proportional verkleinert.</small></div>
      <p class="small muted" id="branding-preview-status" role="status"></p><div id="form-error" class="error-text" role="alert"></div>
      <div class="actions"><button type="submit" class="btn primary">Logo speichern</button>${logo ? localize('<button type="button" class="btn danger" data-action="branding-remove">Logo entfernen</button>') : ""}</div>
    </form></div></section>`);
}

async function saveApplicationName(form) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  document.getElementById("branding-name-error").textContent = "";
  try {
    state.branding = await api("/api/branding", "PUT", {
      app_name: form.elements.app_name.value,
    });
    updateApplicationTitle();
    renderBranding();
    toast(uiText("Anwendungsname gespeichert."));
  } catch (error) {
    document.getElementById("branding-name-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function previewCompanyLogo(input) {
  const file = input.files[0];
  const error = document.getElementById("form-error");
  error.textContent = "";
  document.getElementById("branding-preview-status").textContent = "";
  const preview = document.getElementById("branding-preview");
  preview.innerHTML = state.branding?.logo_url
    ? `<img src="${e(state.branding.logo_url)}" alt="${e(uiText("Firmenlogo"))}">`
    : `<p class="muted">${e(uiText("Kein Firmenlogo hinterlegt."))}</p>`;
  if (!file) return;
  if (
    file.size > 2 * 1024 * 1024 ||
    !["image/png", "image/jpeg", "image/webp"].includes(file.type)
  ) {
    error.textContent = uiText(
      file.size > 2 * 1024 * 1024
        ? "Das Logo darf höchstens 2 MB groß sein."
        : "Bitte ein gültiges PNG-, JPEG- oder WebP-Bild hochladen.",
    );
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    if (!input.isConnected || input.files[0] !== file) return;
    const image = document.createElement("img");
    image.alt = uiText("Vorschau des neuen Firmenlogos");
    image.src = reader.result;
    preview.replaceChildren(image);
    document.getElementById("branding-preview-status").textContent = uiText(
      "Vorschau – das neue Logo ist noch nicht gespeichert.",
    );
  };
  reader.readAsDataURL(file);
}

async function saveCompanyLogo(form) {
  const file = form.elements.logo.files[0];
  if (!file) throw new Error(uiText("Bitte eine Bilddatei auswählen."));
  if (file.size > 2 * 1024 * 1024)
    throw new Error(uiText("Das Logo darf höchstens 2 MB groß sein."));
  state.branding = await api("/api/branding/logo", "PUT", file);
  renderBranding();
  toast(uiText("Firmenlogo gespeichert."));
}

async function removeCompanyLogo() {
  if (!confirm(uiText("Firmenlogo für alle Benutzer entfernen?"))) return;
  state.branding = await api("/api/branding/logo", "DELETE");
  renderBranding();
  toast(uiText("Firmenlogo entfernt."));
}
