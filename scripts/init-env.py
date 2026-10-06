from pathlib import Path
import os
import base64
import secrets

root = Path(__file__).resolve().parents[1]
path = root / ".env"
if path.exists():
    raise SystemExit(".env existiert bereits; nichts überschrieben.")
text = (root / ".env.example").read_text()
for name in ["APP_DB_PASSWORD", "MARIADB_ROOT_PASSWORD", "SESSION_SECRET"]:
    text = text.replace(name + "=CHANGE_ME", name + "=" + secrets.token_urlsafe(32))
text = text.replace(
    "ADMIN_PASSWORD=CHANGE_ME_AT_LEAST_12_CHARACTERS",
    "ADMIN_PASSWORD=" + secrets.token_urlsafe(20),
)
text = text.replace(
    "ENCRYPTION_KEY=CHANGE_ME",
    "ENCRYPTION_KEY=" + base64.urlsafe_b64encode(os.urandom(32)).decode(),
)
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as output:
    output.write(text)
print(".env mit individuellen Geheimnissen erstellt. APP_URL vor dem Start anpassen.")
