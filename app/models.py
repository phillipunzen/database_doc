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
)
from sqlalchemy.engine import URL
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
