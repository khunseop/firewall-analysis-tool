from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo
import logging

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import (
    get_swagger_ui_html,
    get_redoc_html,
    get_swagger_ui_oauth2_redirect_html,
)
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.api_v1.api import api_router as api_v1_router
from app.core.auth import decode_token
from app.core.config import settings
from app.core.logging_config import setup_logging
from app.services.scheduler import sync_scheduler

setup_logging()
logger = logging.getLogger(__name__)

SWAGGER_UI_HTML_PATH = "/docs"
REDOC_HTML_PATH = "/redoc"
SWAGGER_OAUTH2_REDIRECT_PATH = "/docs/oauth2-redirect"
_DOCS_ENABLED = settings.ENVIRONMENT != "production"

STATIC_DIR = Path(__file__).resolve().parent / "static"
REACT_DIST_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

# Paths that skip authentication
_PUBLIC_PREFIXES = (
    "/api/v1/auth/",
    "/static/",
    "/assets/",
    "/fonts/",
    "/favicon",
    "/login",
    "/docs",
    "/redoc",
)

# SPA(index.html)로 폴백하지 않는 경로 prefix — 404 catch-all에서 사용
_NON_SPA_PREFIXES = (
    "/api/",
    "/static/",
    "/assets/",
    "/fonts/",
    "/favicon",
    "/docs",
    "/redoc",
)


class AuthMiddleware(BaseHTTPMiddleware):
    """Redirect unauthenticated browser requests to /login."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        if any(path.startswith(p) for p in _PUBLIC_PREFIXES):
            return await call_next(request)

        if path.startswith("/api/"):
            return await call_next(request)

        token = request.cookies.get("access_token")
        if not token or not decode_token(token):
            return RedirectResponse(url="/login")

        return await call_next(request)


async def _recover_orphaned_export_tasks() -> None:
    """이전 프로세스가 비정상 종료돼 in_progress/pending으로 멈춘 ExportTask를 failure로 정리한다.

    BackgroundTasks로 실행되는 추출 작업은 서버 프로세스에 묶여 있어, 프로세스가 죽으면
    DB의 status가 마지막 값(in_progress)에 그대로 멈춘 채 남는다. 정리하지 않으면
    GET /devices/export-tasks/active가 이 행을 시간 제한 없이 계속 반환해 UI에 진행중
    스피너가 영구히 떠 있는 버그로 이어진다.
    """
    from sqlalchemy import select
    from app.db.session import SessionLocal
    from app.models.export_task import ExportTask

    async with SessionLocal() as db:
        result = await db.execute(
            select(ExportTask).where(ExportTask.status.in_(["pending", "in_progress"]))
        )
        orphaned = result.scalars().all()
        if not orphaned:
            return
        for task in orphaned:
            task.status = "failure"
            task.error_message = "서버가 재시작되어 작업이 중단되었습니다. 다시 시도해주세요."
            task.completed_at = datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
        await db.commit()
        logger.info(f"고아 ExportTask {len(orphaned)}건을 failure로 정리했습니다.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _recover_orphaned_export_tasks()
    sync_scheduler.start()
    await sync_scheduler.load_schedules()
    logger.info("Application started and scheduler initialized")
    yield
    sync_scheduler.stop()
    logger.info("Application shutdown and scheduler stopped")


app = FastAPI(
    title="Firewall Analysis Tool",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url="/api/v1/openapi.json" if _DOCS_ENABLED else None,
    lifespan=lifespan,
)

app.add_middleware(AuthMiddleware)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# React build assets
if REACT_DIST_DIR.exists():
    _assets = REACT_DIST_DIR / "assets"
    _fonts = REACT_DIST_DIR / "fonts"
    if _assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="react-assets")
    if _fonts.exists():
        app.mount("/fonts", StaticFiles(directory=str(_fonts)), name="react-fonts")


if _DOCS_ENABLED:
    @app.get(SWAGGER_UI_HTML_PATH, include_in_schema=False)
    async def custom_swagger_ui_html():
        return get_swagger_ui_html(
            openapi_url=app.openapi_url,
            title=f"{app.title} - Swagger UI",
            oauth2_redirect_url=SWAGGER_OAUTH2_REDIRECT_PATH,
            swagger_js_url="/static/swagger-ui-bundle.js",
            swagger_css_url="/static/swagger-ui.css",
        )

    @app.get(SWAGGER_OAUTH2_REDIRECT_PATH, include_in_schema=False)
    async def swagger_ui_redirect():
        return get_swagger_ui_oauth2_redirect_html()

    @app.get(REDOC_HTML_PATH, include_in_schema=False)
    async def redoc_html():
        return get_redoc_html(
            openapi_url=app.openapi_url,
            title=f"{app.title} - ReDoc",
            redoc_js_url="/static/redoc.standalone.js",
        )


app.include_router(api_v1_router, prefix="/api/v1")


def _serve_react() -> FileResponse:
    """Return React SPA index.html."""
    index = REACT_DIST_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"detail": "Frontend not built"}, status_code=503)


@app.get("/favicon.svg", include_in_schema=False)
async def serve_favicon():
    return FileResponse(REACT_DIST_DIR / "favicon.svg", media_type="image/svg+xml")


@app.exception_handler(StarletteHTTPException)
async def spa_fallback_handler(request: Request, exc: StarletteHTTPException):
    """SPA catch-all: 등록되지 않은 GET 경로의 404는 React index.html로 폴백.

    클라이언트 라우트를 백엔드에 개별 등록하지 않아도 새로고침/직접 접근이 동작한다.
    """
    if exc.status_code == 404:
        path = request.url.path
        if not any(path.startswith(p) for p in _NON_SPA_PREFIXES):
            return _serve_react()
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
