"""Actionable database diagnostics without SQL, credentials or driver message text."""

import re
from .i18n import tr, DATABASE_ERROR_TEMPLATE

STEPS = {
    "connect": "Verbindung aufbauen",
    "schemas": "Schemas auflisten",
    "tables": "Tabellen auflisten",
    "views": "Views auflisten",
    "columns": "Spalten auslesen",
    "primary_key": "Primärschlüssel auslesen",
    "foreign_keys": "Fremdschlüssel auslesen",
    "indexes": "Indizes auslesen",
    "unique": "Eindeutigkeitsregeln auslesen",
    "comments": "Objektkommentare auslesen",
    "collections": "Collections auflisten",
    "fields": "Dokumentfelder ableiten",
    "metadata": "Struktur auslesen",
    "save": "Dokumentation speichern",
    "test": "Verbindung testen",
    "value_search": "Beispielwert suchen",
}
REASONS = {
    "unknown": "Die Ursache ist noch nicht eindeutig. Fehlercode und Schritt bei der Fehlersuche angeben; Erreichbarkeit, Leserechte und Datenbankzustand prüfen.",
    "auth": "Die Datenbank hat die Anmeldung abgelehnt. Benutzer, Passwort und zulässigen Client-Host prüfen.",
    "permissions": "Die Datenbank hat einen Zugriff verweigert. Leserechte und Metadatenrechte prüfen; bei MySQL/MariaDB-Views auch SHOW VIEW sowie die Rechte des Definers prüfen.",
    "database": "Die angegebene Datenbank wurde nicht gefunden. Datenbankname und Zielserver prüfen.",
    "object": "Ein benötigtes Datenbankobjekt wurde nicht gefunden. Gleichzeitige Schemaänderungen und Objektzustand prüfen.",
    "view": "Eine View hat ungültige Referenzen oder fehlende Definer-/Invoker-Rechte. Die betroffene View und ihre referenzierten Objekte durch den Datenbankadministrator prüfen lassen.",
    "definer": "Ein benötigter Datenbankbenutzer existiert nicht. Bei Views oder Routinen den Definer durch den Datenbankadministrator prüfen lassen.",
    "connect": "Die Verbindung zur Datenbank konnte nicht aufgebaut werden. DNS, Host, Port und Firewall prüfen.",
    "lost": "Die Datenbankverbindung wurde unterbrochen. Netzwerk, Abfragedauer, Client-/Server-Timeouts und Serverprotokoll prüfen.",
    "tls": "Der TLS-Verbindungsaufbau ist fehlgeschlagen. Zertifikatskette, Hostname und TLS-Konfiguration prüfen.",
    "timeout": "Die Abfrage wurde wegen einer Zeitüberschreitung abgebrochen. Serverauslastung und Dauer der Metadatenabfrage prüfen.",
    "lock": "Die Abfrage ist an einer Sperrwartezeit gescheitert. Gleichzeitige Transaktionen und Serverprotokoll prüfen.",
    "packet": "Das Datenpaket überschreitet eine Datenbankgrenze. max_allowed_packet auf dem Server des angegebenen Schritts prüfen.",
}
MYSQL_REASONS = {
    1044: "permissions",
    1045: "auth",
    1049: "database",
    1142: "permissions",
    1143: "permissions",
    1227: "permissions",
    1146: "object",
    1356: "view",
    1449: "definer",
    2002: "connect",
    2003: "connect",
    2005: "connect",
    2006: "lost",
    2013: "lost",
    2026: "tls",
    3024: "timeout",
    1969: "timeout",
    1205: "lock",
    1153: "packet",
    2020: "packet",
}


def diagnostic(kind, error, step="metadata"):
    number, state = None, None
    pending, seen = [error], set()
    # Reflection can wrap a DBAPIError in UnreflectableTableError. Follow the
    # exception chain without rendering any message, statement or parameters.
    while pending and len(seen) < 8:
        original = pending.pop(0)
        if id(original) in seen:
            continue
        seen.add(id(original))
        args = getattr(original, "args", ())
        if kind in {"mysql", "mariadb"} and args and type(args[0]) is int:
            number = args[0] if 0 <= args[0] <= 99999 else number
        candidate = getattr(original, "sqlstate", None) or getattr(
            original, "pgcode", None
        )
        if kind == "mssql" and args and isinstance(args[0], str):
            candidate = args[0]
        if isinstance(candidate, str) and re.fullmatch(r"[0-9A-Z]{5}", candidate):
            state = candidate
        for name in ["orig", "__cause__", "__context__"]:
            if name == "__context__" and getattr(
                original, "__suppress_context__", False
            ):
                continue
            inner = getattr(original, name, None)
            if inner is not None and id(inner) not in seen:
                pending.append(inner)
    if not isinstance(state, str) or not re.fullmatch(r"[0-9A-Z]{5}", state):
        state = None
    name = type(error).__name__
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name):
        name = "DatabaseError"
    label = {"mysql": "MySQL", "mariadb": "MariaDB"}.get(kind, "DB")
    signature = name
    if number is not None:
        signature += f"; {label} {number}"
    if state:
        signature += f"; SQLSTATE {state}"
    reason = MYSQL_REASONS.get(number, "unknown")
    if reason == "unknown" and state:
        reason = {
            "42501": "permissions",
            "28P01": "auth",
            "28000": "auth",
            "3D000": "database",
            "42P01": "object",
            "HYT00": "timeout",
            "HYT01": "timeout",
        }.get(state, "connect" if state.startswith("08") else "unknown")
    return tr(
        DATABASE_ERROR_TEMPLATE,
        signature,
        tr(STEPS.get(step, STEPS["metadata"])),
        tr(REASONS[reason]),
    )
