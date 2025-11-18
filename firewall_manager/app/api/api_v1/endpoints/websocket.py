"""
WebSocket 엔드포인트
동기화 상태 실시간 업데이트를 위한 WebSocket 연결
"""
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.websocket_manager import websocket_manager

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/sync-status")
async def websocket_endpoint(websocket: WebSocket):
    """
    동기화 상태 실시간 업데이트를 위한 WebSocket 연결
    
    클라이언트가 연결되면 장비 동기화 상태 변경 시 자동으로 메시지를 받습니다.
    메시지 형식:
    {
        "type": "device_sync_status",
        "device_id": 1,
        "status": "pending" | "in_progress" | "success" | "failure",
        "step": "Collecting network objects..." | null
    }
    """
    await websocket_manager.connect(websocket)
    try:
        # 연결 유지 (클라이언트가 연결을 끊을 때까지 대기)
        while True:
            # 클라이언트로부터 메시지 수신 (ping/pong 용)
            data = await websocket.receive_text()
            logger.debug(f"WebSocket 메시지 수신: {data}")
    except WebSocketDisconnect:
        websocket_manager.disconnect(websocket)
        logger.info("WebSocket 연결이 정상적으로 종료됨")
    except Exception as e:
        logger.error(f"WebSocket 오류: {e}", exc_info=True)
        websocket_manager.disconnect(websocket)





