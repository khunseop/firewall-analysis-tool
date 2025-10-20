from fastapi import APIRouter
from app.api.api_v1.endpoints import devices, firewall_data

api_router = APIRouter()
api_router.include_router(devices.router, prefix="/devices", tags=["devices"])
api_router.include_router(firewall_data.router, prefix="/firewall", tags=["firewall-data"])
