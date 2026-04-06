from pathlib import Path
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
from app.services.scheduler import sync_scheduler

logger = logging.getLogger(__name__)

SWAGGER_UI_HTML_PATH = "/docs"
REDOC_HTML_PATH = "/redoc"
SWAGGER_OAUTH2_REDIRECT_PATH = "/docs/oauth2-redirect"

STATIC_DIR = Path(__file__).resolve().parent / "static"
REACT_DIST_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

# Paths that skip authentication
_PUBLIC_PREFIXES = (
    "/api/v1/auth/",
    "/static/",
    "/assets/",
    "/fonts/",
    "/login",
    "/docs",
    "/redoc",
)

# All SPA client-side routes (served by React Router)
_SPA_ROUTES = (
    "/",
    "/devices",
    "/policies",
    "/objects",
    "/analysis",
    "/schedules",
    "/notifications",
    "/settings",
    "/deletion-workflow",
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


app = FastAPI(
    title="Firewall Analysis Tool",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url="/api/v1/openapi.json",
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


def _serve_react(fallback_status: int = 200) -> FileResponse:
    """Return React SPA index.html."""
    index = REACT_DIST_DIR / "index.html"
    if index.exists():
        return FileResponse(index)
    return JSONResponse({"detail": "Frontend not built"}, status_code=503)


@app.get("/login", include_in_schema=False)
def serve_login():
    return _serve_react()


# Explicit SPA route handlers so React Router BrowserRouter works
for _route in _SPA_ROUTES:
    app.add_api_route(
        _route,
        _serve_react,
        methods=["GET"],
        include_in_schema=False,
    )


@app.exception_handler(StarletteHTTPException)
async def spa_fallback_handler(request: Request, exc: StarletteHTTPException):
    """Catch-all 404 handler for any React Router path not explicitly listed."""
    if exc.status_code == 404:
        path = request.url.path
        excluded = ("/api/", "/static/", "/assets/", "/fonts/", "/docs", "/redoc")
        if not any(path.startswith(p) for p in excluded):
            index = REACT_DIST_DIR / "index.html"
            if index.exists():
                return FileResponse(index)
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)


@app.on_event("startup")
async def startup_event():
    sync_scheduler.start()
    await sync_scheduler.load_schedules()
    logger.info("Application started and scheduler initialized")


@app.on_event("shutdown")
async def shutdown_event():
    sync_scheduler.stop()
    logger.info("Application shutdown and scheduler stopped")
