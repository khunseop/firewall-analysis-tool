from pathlib import Path
import logging

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import (
    get_swagger_ui_html,
    get_redoc_html,
    get_swagger_ui_oauth2_redirect_html,
)
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.api_v1.api import api_router as api_v1_router
from app.core.auth import decode_token
from app.services.scheduler import sync_scheduler

logger = logging.getLogger(__name__)

SWAGGER_UI_HTML_PATH = "/docs"
REDOC_HTML_PATH = "/redoc"
SWAGGER_OAUTH2_REDIRECT_PATH = "/docs/oauth2-redirect"

STATIC_DIR = Path(__file__).resolve().parent / "static"
FRONTEND_DIR = Path(__file__).resolve().parent / "frontend"
REACT_DIST_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

# Paths that do NOT require authentication
_PUBLIC_PREFIXES = ("/api/v1/auth/", "/static/", "/assets/", "/fonts/", "/login", "/docs", "/redoc")


class AuthMiddleware(BaseHTTPMiddleware):
    """Redirect unauthenticated browser requests to /login."""

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip auth check for public paths
        if any(path.startswith(p) for p in _PUBLIC_PREFIXES):
            return await call_next(request)

        # API routes handled by FastAPI dependency — skip here to return proper 401 JSON
        if path.startswith("/api/"):
            return await call_next(request)

        # For page routes (/, /app/*), check access_token cookie
        token = request.cookies.get("access_token")
        if not token or not decode_token(token):
            return RedirectResponse(url="/login")

        return await call_next(request)


app = FastAPI(
    title="Firewall Analysis Tool",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url="/api/v1/openapi.json",
)

app.add_middleware(AuthMiddleware)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/app", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="app")

# React frontend build (served when dist/ exists)
if REACT_DIST_DIR.exists():
    _react_assets = REACT_DIST_DIR / "assets"
    _react_fonts = REACT_DIST_DIR / "fonts"
    if _react_assets.exists():
        app.mount("/assets", StaticFiles(directory=str(_react_assets)), name="react-assets")
    if _react_fonts.exists():
        app.mount("/fonts", StaticFiles(directory=str(_react_fonts)), name="react-fonts")


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


@app.get("/login", include_in_schema=False)
def serve_login():
    """Login page — React build if available, fallback to old frontend."""
    if REACT_DIST_DIR.exists() and (REACT_DIST_DIR / "index.html").exists():
        return FileResponse(REACT_DIST_DIR / "index.html")
    return FileResponse(FRONTEND_DIR / "login.html")


@app.get("/", include_in_schema=False)
def serve_index():
    """Root — React build if available, fallback to old frontend."""
    if REACT_DIST_DIR.exists() and (REACT_DIST_DIR / "index.html").exists():
        return FileResponse(REACT_DIST_DIR / "index.html")
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/analysis", include_in_schema=False)
def serve_analysis_page():
    """Analysis page — React build if available."""
    if REACT_DIST_DIR.exists() and (REACT_DIST_DIR / "index.html").exists():
        return FileResponse(REACT_DIST_DIR / "index.html")
    return FileResponse(FRONTEND_DIR / "templates/analysis.html")


@app.get("/{react_path:path}", include_in_schema=False)
def serve_react_app(react_path: str):
    """Catch-all for React Router BrowserRouter paths.
    Excludes /app/* (old frontend with Deletion Workflow) and /api/*, /static/*, /assets/*, /fonts/*.
    """
    excluded = ("app/", "api/", "static/", "assets/", "fonts/", "docs", "redoc")
    if any(react_path.startswith(prefix) for prefix in excluded):
        from fastapi import HTTPException
        raise HTTPException(status_code=404)
    if REACT_DIST_DIR.exists() and (REACT_DIST_DIR / "index.html").exists():
        return FileResponse(REACT_DIST_DIR / "index.html")
    return FileResponse(FRONTEND_DIR / "index.html")


@app.on_event("startup")
async def startup_event():
    sync_scheduler.start()
    await sync_scheduler.load_schedules()
    logger.info("Application started and scheduler initialized")


@app.on_event("shutdown")
async def shutdown_event():
    sync_scheduler.stop()
    logger.info("Application shutdown and scheduler stopped")
