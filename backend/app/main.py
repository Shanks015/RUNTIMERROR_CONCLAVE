import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .config import get_settings
from .database import init_db
from .routers import auth, operator, trips, ws
from .services.ws import manager

DASHBOARD_HTML = Path(__file__).parent / "static" / "dashboard.html"

settings = get_settings()
logger = logging.getLogger("emergency-driver")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("Database schema verified against Supabase Postgres")
    yield
    # Cancel any lingering mock-control-center tasks.
    for task in asyncio.all_tasks():
        if task is not asyncio.current_task():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logger.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": settings.app_name}


app.include_router(auth.router)
app.include_router(trips.router)
app.include_router(operator.router)
app.include_router(ws.router)


@app.get("/dashboard", include_in_schema=False)
async def dashboard():
    """Operator console — single static page, talks to /api/operator over fetch + WS."""
    return FileResponse(DASHBOARD_HTML)
