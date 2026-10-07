async function loadBranding() {
  state.branding = await api("/api/branding");
}

function renderBranding() {
  const logo = state.branding?.logo_url;
  shell(localize`<div class="page-head"><div><div class="eyebrow">Administration</div><h1>Firmenlogo</h1><p>Ein gemeinsames Logo für eure DatabaseDoc-Installation.</p></div></div>
    <section class="panel branding-panel"><div class="panel-body"><form id="branding-form">
      <h2>Logo-Vorschau</h2><div class="branding-preview" id="branding-preview">${logo ? `<img src="${e(logo)}" alt="${e(uiText("Firmenlogo"))}">` : `<p class="muted">${e(uiText("Kein Firmenlogo hinterlegt."))}</p>`}</div>
      <p class="muted">Das Logo erscheint auf der Anmeldung, in der Seitenleiste und in Tabellen- und ER-PDFs. Es gilt für alle Benutzer.</p>
      <div class="field"><label for="company-logo-file">Logo auswählen</label><input id="company-logo-file" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required aria-describedby="company-logo-help"><small id="company-logo-help">PNG, JPEG oder WebP, maximal 2 MB. Transparente PNGs eignen sich besonders gut. Das Logo wird proportional verkleinert.</small></div>
      <p class="small muted" id="branding-preview-status" role="status"></p><div id="form-error" class="error-text" role="alert"></div>
      <div class="actions"><button type="submit" class="btn primary">Logo speichern</button>${logo ? localize('<button type="button" class="btn danger" data-action="branding-remove">Logo entfernen</button>') : ""}</div>
    </form></div></section>`);
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
