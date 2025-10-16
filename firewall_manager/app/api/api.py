from fastapi import APIRouter
from app.api.endpoints import firewall_devices, analysis

api_router = APIRouter()
api_router.include_router(firewall_devices.router, prefix="/devices", tags=["devices"])
api_router.include_router(analysis.router, prefix="/analysis", tags=["analysis"])