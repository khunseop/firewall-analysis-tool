from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.api_v1.api import api_router as api_v1_router

app = FastAPI(
    title="Firewall Analysis Tool",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    swagger_ui_oauth2_redirect_url="/docs/oauth2-redirect",
    openapi_url="/api/v1/openapi.json"
)

app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Override default docs URLs
app.swagger_ui_html_path = "/docs"
app.redoc_html_path = "/redoc"
app.swagger_ui_oauth2_redirect_path = "/docs/oauth2-redirect"

@app.get(app.swagger_ui_html_path, include_in_schema=False)
async def custom_swagger_ui_html():
    return app.get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title=app.title + " - Swagger UI",
        oauth2_redirect_url=app.swagger_ui_oauth2_redirect_url,
        swagger_js_url="/static/swagger-ui-bundle.js",
        swagger_css_url="/static/swagger-ui.css",
    )

@app.get(app.redoc_html_path, include_in_schema=False)
async def redoc_html():
    return app.get_redoc_html(
        openapi_url=app.openapi_url,
        title=app.title + " - ReDoc",
        redoc_js_url="/static/redoc.standalone.js",
    )

app.include_router(api_v1_router, prefix="/api/v1")

@app.get("/")
def read_root():
    return {"message": "Welcome to the Firewall Analysis Tool API"}
