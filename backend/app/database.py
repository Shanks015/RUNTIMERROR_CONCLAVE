import ssl as ssl_module

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import get_settings

settings = get_settings()

# Supabase Postgres always speaks TLS; asyncpg takes a plain "require" here
# (certificate verification is handled by the platform for this prototype).
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    connect_args={"ssl": "require", "command_timeout": 15},
)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    # Import models so metadata is populated before create_all.
    from . import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Columns added after the first deploy: create_all never alters tables,
        # so keep them as idempotent statements.
        for statement in (
            "ALTER TABLE emergency_trips ADD COLUMN IF NOT EXISTS completion_status VARCHAR(32)",
            "ALTER TABLE incident_reports ADD COLUMN IF NOT EXISTS road_segment VARCHAR(64)",
        ):
            await conn.exec_driver_sql(statement)
