"""
WebSocket 연결 매니저
동기화 상태 변경을 실시간으로 클라이언트에 브로드캐스트
"""
import json
import logging
from typing import Dict, Set
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    """WebSocket 연결을 관리하고 브로드캐스트하는 매니저"""
    
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
    
    async def connect(self, websocket: WebSocket):
        """클라이언트 연결 수락"""
        await websocket.accept()
        self.active_connections.add(websocket)
        logger.info(f"WebSocket 연결됨. 총 연결 수: {len(self.active_connections)}")
    
    def disconnect(self, websocket: WebSocket):
        """클라이언트 연결 해제"""
        self.active_connections.discard(websocket)
        logger.info(f"WebSocket 연결 해제됨. 총 연결 수: {len(self.active_connections)}")
    
    async def broadcast_device_status(self, device_id: int, status: str, step: str | None = None):
        """장비 동기화 상태 변경을 모든 연결된 클라이언트에 브로드캐스트"""
        message = {
            "type": "device_sync_status",
            "device_id": device_id,
            "status": status,
            "step": step
        }
        
        if not self.active_connections:
            logger.debug(f"WebSocket 활성 연결이 없음. 장비 {device_id} 상태 브로드캐스트 스킵: {status} ({step})")
            return
        
        disconnected = set()
        success_count = 0
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
                success_count += 1
            except Exception as e:
                logger.warning(f"WebSocket 메시지 전송 실패: {e}")
                disconnected.add(connection)
        
        # 연결이 끊어진 클라이언트 제거
        for connection in disconnected:
            self.disconnect(connection)
        
        logger.debug(f"WebSocket 브로드캐스트: 장비 {device_id}, 상태={status}, 단계={step}, 성공={success_count}/{len(self.active_connections)}")


# 전역 인스턴스
websocket_manager = WebSocketManager()

