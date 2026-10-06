import os
import tempfile
from pathlib import Path
from cryptography.fernet import Fernet

os.environ["TEST_DATABASE_URL"] = "sqlite:///" + tempfile.mktemp(suffix=".sqlite")
os.environ["ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["SESSION_SECRET"] = "a-test-session-secret-with-sufficient-length"
os.environ["ADMIN_PASSWORD"] = "test-admin-password-123"
os.environ["COOKIE_SECURE"] = "false"
os.environ["APP_URL"] = "http://testserver"
os.environ["SQLITE_ROOT"] = tempfile.mkdtemp()

os.environ["DISABLE_SCHEDULER"] = "1"
