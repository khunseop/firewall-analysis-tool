from fastapi import FastAPI
from app.api.api_v1.api import api_router as api_v1_router

app = FastAPI(title="Firewall Analysis Tool", version="0.1.0")

app.include_router(api_v1_router, prefix="/api/v1")

@app.get("/")
def read_root():
    return {"message": "Welcome to the Firewall Analysis Tool API"}
