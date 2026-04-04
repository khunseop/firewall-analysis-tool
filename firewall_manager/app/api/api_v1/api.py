from fastapi import APIRouter, Depends
from app.api.api_v1.endpoints import (
    devices, firewall_sync, firewall_query, export, analysis,
    websocket, sync_schedule, settings, notifications, deletion_workflow,
)
from app.api.api_v1.endpoints import auth
from app.core.auth import get_current_user

api_router = APIRouter()

# Public: auth endpoints (no authentication required)
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])

# Protected: all other endpoints require a valid JWT
_auth = [Depends(get_current_user)]

api_router.include_router(devices.router, prefix="/devices", tags=["devices"], dependencies=_auth)
api_router.include_router(firewall_sync.router, prefix="/firewall", tags=["firewall-sync"], dependencies=_auth)
api_router.include_router(firewall_query.router, prefix="/firewall", tags=["firewall-query"], dependencies=_auth)
api_router.include_router(export.router, prefix="/firewall", tags=["export"], dependencies=_auth)
api_router.include_router(analysis.router, prefix="/analysis", tags=["analysis"], dependencies=_auth)
api_router.include_router(websocket.router, tags=["websocket"])  # auth handled in-endpoint via query param
api_router.include_router(sync_schedule.router, prefix="/sync-schedules", tags=["sync-schedules"], dependencies=_auth)
api_router.include_router(settings.router, prefix="/settings", tags=["settings"], dependencies=_auth)
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"], dependencies=_auth)
api_router.include_router(deletion_workflow.router, prefix="/deletion-workflow", tags=["deletion-workflow"], dependencies=_auth)
