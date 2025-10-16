from fastapi import FastAPI
from app.api.api import api_router
import sys
import os

# 프로젝트 루트 디렉토리를 sys.path에 추가
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))


app = FastAPI(
    title="Firewall Manager API",
    description="API for managing and analyzing firewall policies.",
    version="0.1.0",
)

app.include_router(api_router, prefix="/api/v1")

@app.get("/")
def read_root():
    return {"message": "Welcome to Firewall Manager API"}