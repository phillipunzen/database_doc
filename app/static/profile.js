// Language is loaded before the translated module constants on every page load.
function profileNeedsReload(user) {
  return (user.language || "auto") !== UI_PROFILE_LANGUAGE;
}

function renderProfile() {
  const p = state.profile,
    u = p.user,
    local = u.provider === "local";
  shell(
    localize`<div class="page-head"><div><div class="eyebrow">Mein Konto</div><h1>Profileinstellungen</h1><p>Verwalte deine persönlichen Einstellungen für DatabaseDoc.</p></div></div><section class="panel panel-body profile-panel"><h2>Sprache und Profil</h2><form id="profile-form"><div class="field"><label for="profile-name">Anzeigename</label><input id="profile-name" name="display_name" value="${e(u.display_name)}" maxlength="190" required ${local ? "" : "disabled"}>${!local ? localize("<small>Der Anzeigename wird über Microsoft AD oder Entra ID verwaltet.</small>") : ""}</div><div class="field"><label for="profile-language">Sprache</label><select id="profile-language" name="language"><option value="auto" ${p.language === "auto" ? "selected" : ""}>Browsersprache verwenden</option><option value="de" ${p.language === "de" ? "selected" : ""}>Deutsch</option><option value="en" ${p.language === "en" ? "selected" : ""}>English</option></select><small>Die Auswahl gilt für dein Konto auf allen Geräten. Bei einer Sprachänderung wird die Seite nach dem Speichern neu geladen.</small></div><p class="small muted">${e(uiText("Aktuell verwendete Sprache: {0}", uiLanguage === "de" ? uiText("Deutsch") : "English"))}</p><div id="profile-error" class="error-text" role="alert"></div><button class="btn primary" type="submit">Profil speichern</button><p id="profile-status" class="small" role="status" aria-live="polite"></p></form></section><section class="panel panel-body profile-panel"><h2>Konto und Anmeldung</h2><dl class="profile-account"><div><dt>Benutzername</dt><dd>${e(u.username)}</dd></div><div><dt>Rolle</dt><dd>${e(roles[u.role])}</dd></div><div><dt>Anmeldung</dt><dd>${e({ local: uiText("Lokales Konto"), ad: "Microsoft AD", entra: "Entra ID" }[u.provider])}</dd></div></dl>${local ? localize('<button class="btn" type="button" data-action="password">Passwort ändern</button>') : localize('<p class="small muted">Dein Passwort wird über Microsoft AD oder Entra ID verwaltet.</p>')}<p class="small muted">Rollen und Datenbankfreigaben verwaltet ein Administrator.</p></section>`,
  );
}

async function profileSubmit(form) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  document.getElementById("profile-error").textContent = "";
  document.getElementById("profile-status").textContent = "";
  const data = Object.fromEntries(new FormData(form)),
    userId = state.user.id;
  try {
    const result = await api("/api/profile", "PUT", data);
    if (state.user?.id !== userId) return;
    state.user = { ...result.user, language: result.language };
    state.profile = result;
    if (profileNeedsReload(state.user)) {
      location.reload();
      return;
    }
    if (state.view === "profile") {
      renderProfile();
      document.getElementById("profile-status").textContent = uiText(
        "Profil gespeichert.",
      );
    }
  } catch (error) {
    if (state.user?.id === userId && state.view === "profile")
      document.getElementById("profile-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}
