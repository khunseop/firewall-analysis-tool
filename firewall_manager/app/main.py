from pathlib import Path
import asyncio

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import (
    get_swagger_ui_html,
    get_redoc_html,
    get_swagger_ui_oauth2_redirect_html,
)

from alembic import command
from alembic.config import Config as AlembicConfig

from app.api.api_v1.api import api_router as api_v1_router


SWAGGER_UI_HTML_PATH = "/docs"
REDOC_HTML_PATH = "/redoc"
SWAGGER_OAUTH2_REDIRECT_PATH = "/docs/oauth2-redirect"


app = FastAPI(
    title="Firewall Analysis Tool",
    version="0.1.0",
    docs_url=None,  # We provide custom docs served from local static assets
    redoc_url=None,
    openapi_url="/api/v1/openapi.json",
)

# Mount local static assets regardless of current working directory
STATIC_DIR = Path(__file__).resolve().parent / "static"
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


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


@app.on_event("startup")
async def apply_migrations_on_startup():
    """Apply Alembic migrations to head automatically on startup.

    Runs inside a worker thread to avoid event loop conflicts with Alembic's
    internal asyncio usage.
    """
    project_root = Path(__file__).resolve().parents[1]
    alembic_ini = project_root / "alembic.ini"

    def _upgrade_head():
        cfg = AlembicConfig(str(alembic_ini))
        cfg.set_main_option("script_location", str(project_root / "alembic"))
        try:
            command.upgrade(cfg, "head")
        except Exception:
            # Avoid failing app startup due to migration error; surface via logs
            import logging
            logging.getLogger(__name__).exception("Alembic upgrade failed on startup")

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _upgrade_head)


app.include_router(api_v1_router, prefix="/api/v1")


@app.get("/")
def read_root():
    return {"message": "Welcome to the Firewall Analysis Tool API"}
