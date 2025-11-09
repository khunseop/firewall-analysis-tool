from fastapi import APIRouter
from app.api.api_v1.endpoints import devices, firewall_sync, firewall_query, export, analysis, websocket, sync_schedule

api_router = APIRouter()
api_router.include_router(devices.router, prefix="/devices", tags=["devices"])
api_router.include_router(firewall_sync.router, prefix="/firewall", tags=["firewall-sync"])
api_router.include_router(firewall_query.router, prefix="/firewall", tags=["firewall-query"])
api_router.include_router(export.router, prefix="/firewall", tags=["export"])
api_router.include_router(analysis.router, prefix="/analysis", tags=["analysis"])
api_router.include_router(websocket.router, tags=["websocket"])
api_router.include_router(sync_schedule.router, prefix="/sync-schedules", tags=["sync-schedules"])
