import os
from datetime import datetime, timezone
from sqlalchemy import (
    create_engine,
    String,
    Text,
    Integer,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    UniqueConstraint,
    LargeBinary,
)
from sqlalchemy.engine import URL
from sqlalchemy.dialects.mysql import MEDIUMTEXT, MEDIUMBLOB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(190), unique=True)
    display_name: Mapped[str] = mapped_column(String(190))
    password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    identity: Mapped[str | None] = mapped_column(
        String(190), nullable=True, unique=True
    )
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class LoginSession(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    csrf: Mapped[str] = mapped_column(String(64))
    expires: Mapped[datetime] = mapped_column(DateTime)


class UserPreference(Base):
    __tablename__ = "user_preferences"
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    language: Mapped[str] = mapped_column(String(10), default="auto")


class Source(Base):
    __tablename__ = "sources"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(190))
    kind: Mapped[str] = mapped_column(String(30))
    config_encrypted: Mapped[str] = mapped_column(Text)
    mongo_infer: Mapped[bool] = mapped_column(Boolean, default=False)
    created: Mapped[datetime] = mapped_column(DateTime, default=now)


class Grant(Base):
    __tablename__ = "grants"
    __table_args__ = (UniqueConstraint("source_id", "user_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    edit: Mapped[bool] = mapped_column(Boolean, default=False)
    data: Mapped[bool] = mapped_column(Boolean, default=False)


class Snapshot(Base):
    __tablename__ = "snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"))
    created: Mapped[datetime] = mapped_column(DateTime, default=now)
    payload: Mapped[dict] = mapped_column(JSON)


class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(30), default="queued")
    message: Mapped[str] = mapped_column(Text, default="Scan wartet.")
    created: Mapped[datetime] = mapped_column(DateTime, default=now)
    finished: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Note(Base):
    __tablename__ = "notes"
    __table_args__ = (UniqueConstraint("source_id", "table_key"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id", ondelete="CASCADE"))
    table_key: Mapped[str] = mapped_column(String(350))
    text: Mapped[str] = mapped_column(Text)


class Audit(Base):
    __tablename__ = "audit"
    id: Mapped[int] = mapped_column(primary_key=True)
    user: Mapped[str] = mapped_column(String(190))
    action: Mapped[str] = mapped_column(String(190))
    target: Mapped[str] = mapped_column(String(190))
    created: Mapped[datetime] = mapped_column(DateTime, default=now)


class SourceMetadata(Base):
    __tablename__ = "source_metadata"
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), primary_key=True
    )
    tags: Mapped[list] = mapped_column(JSON, default=list)
    owner: Mapped[str] = mapped_column(String(190), default="")
    owner_email: Mapped[str] = mapped_column(String(190), default="")


class CatalogTag(Base):
    __tablename__ = "catalog_tags"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(60))
    color: Mapped[str] = mapped_column(String(20), default="gray")
    category: Mapped[str] = mapped_column(String(20), default="other")
    version: Mapped[int] = mapped_column(Integer, default=1)


class ScanSchedule(Base):
    __tablename__ = "scan_schedules"
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), primary_key=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    cadence: Mapped[str] = mapped_column(String(20), default="daily")
    hour: Mapped[int] = mapped_column(Integer, default=2)
    minute: Mapped[int] = mapped_column(Integer, default=0)
    weekday: Mapped[int] = mapped_column(Integer, default=0)
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Berlin")
    next_run: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True, index=True
    )
    last_started: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_job_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    message: Mapped[str] = mapped_column(Text, default="")
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )


class SearchEntry(Base):
    __tablename__ = "search_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(20))
    table_key: Mapped[str] = mapped_column(Text)
    table_name: Mapped[str] = mapped_column(Text)
    column_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text)
    content: Mapped[str] = mapped_column(Text().with_variant(MEDIUMTEXT(), "mysql"))


class SchemaVersion(Base):
    __tablename__ = "schema_versions"
    version: Mapped[str] = mapped_column(String(64), primary_key=True)
    created: Mapped[datetime] = mapped_column(DateTime, default=now)


class ApplicationSettings(Base):
    __tablename__ = "application_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    app_name: Mapped[str] = mapped_column(String(80), default="DatabaseDoc")
    updated: Mapped[datetime] = mapped_column(DateTime, default=now)


class ApplicationBranding(Base):
    __tablename__ = "application_branding"
    id: Mapped[int] = mapped_column(primary_key=True)
    logo: Mapped[bytes] = mapped_column(
        LargeBinary().with_variant(MEDIUMBLOB(), "mysql")
    )
    version: Mapped[str] = mapped_column(String(64))
    updated: Mapped[datetime] = mapped_column(DateTime, default=now)


class WarehouseProject(Base):
    __tablename__ = "warehouse_projects"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(190))
    goal: Mapped[str] = mapped_column(Text, default="")
    target_kind: Mapped[str] = mapped_column(String(30))
    target_schema: Mapped[str] = mapped_column(String(63))
    target_source_id: Mapped[int | None] = mapped_column(
        ForeignKey("sources.id"), nullable=True
    )
    blueprint: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated: Mapped[datetime] = mapped_column(DateTime, default=now)


class WarehouseProjectSource(Base):
    __tablename__ = "warehouse_project_sources"
    project_id: Mapped[int] = mapped_column(
        ForeignKey("warehouse_projects.id", ondelete="CASCADE"), primary_key=True
    )
    source_id: Mapped[int] = mapped_column(ForeignKey("sources.id"), primary_key=True)


class WarehouseWorkspace(Base):
    __tablename__ = "warehouse_workspaces"
    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("warehouse_projects.id"), unique=True
    )
    content: Mapped[dict] = mapped_column(JSON, default=dict)


class DatabaseDesign(Base):
    __tablename__ = "database_designs"
    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated: Mapped[datetime] = mapped_column(DateTime, default=now)


class DatabaseDesignGrant(Base):
    __tablename__ = "database_design_grants"
    design_id: Mapped[int] = mapped_column(
        ForeignKey("database_designs.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    edit: Mapped[bool] = mapped_column(Boolean, default=False)


class SourceAnalysis(Base):
    __tablename__ = "source_analysis"
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), primary_key=True
    )
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated: Mapped[datetime] = mapped_column(DateTime, default=now)


class SourceProfile(Base):
    __tablename__ = "source_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("sources.id", ondelete="CASCADE"), index=True
    )
    snapshot_id: Mapped[int] = mapped_column(Integer)
    table_key: Mapped[str] = mapped_column(Text)
    content: Mapped[dict] = mapped_column(JSON)
    created: Mapped[datetime] = mapped_column(DateTime, default=now)


class BusinessConcept(Base):
    __tablename__ = "business_concepts"
    id: Mapped[int] = mapped_column(primary_key=True)
    content: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer, default=1)
    updated: Mapped[datetime] = mapped_column(DateTime, default=now)


if os.getenv("TEST_DATABASE_URL"):
    engine = create_engine(
        os.environ["TEST_DATABASE_URL"], connect_args={"check_same_thread": False}
    )
else:
    engine = create_engine(
        URL.create(
            "mysql+pymysql",
            username=os.getenv("APP_DB_USER", "datatlas"),
            password=os.environ["APP_DB_PASSWORD"],
            host=os.getenv("APP_DB_HOST", "mariadb"),
            database=os.getenv("APP_DB_NAME", "datatlas"),
        ),
        pool_pre_ping=True,
        pool_recycle=1800,
    )
Session = sessionmaker(engine, expire_on_commit=False)
