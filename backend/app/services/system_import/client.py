"""시스템 현황 대시보드의 `/api/assets`를 읽는 클라이언트 (GET만, 리다이렉트 미추종)."""
from typing import Optional

import httpx

from app.schemas.system_import import DashboardRow

PAGE_SIZE = 500            # 대시보드 MAX_PAGE_SIZE
MAX_PAGES = 200            # 비정상 서버가 끝없이 페이지를 돌려줄 때를 막는 상한
MAX_RESPONSE_BYTES = 20 * 1024 * 1024
_TIMEOUT = httpx.Timeout(30.0, connect=5.0)
_ROW_FIELDS = frozenset(DashboardRow.model_fields)


class DashboardFetchError(Exception):
    """대시보드 주소 오류·연결 실패·응답 형식 오류 등 읽기에 실패한 모든 경우."""


def _to_row(item: object) -> DashboardRow:
    if not isinstance(item, dict):
        raise DashboardFetchError("대시보드 응답의 items에 객체가 아닌 값이 있습니다.")
    return DashboardRow(**{k: (None if v is None else str(v)) for k, v in item.items() if k in _ROW_FIELDS})


async def fetch_assets(base_url: str, *, transport: Optional[httpx.AsyncBaseTransport] = None) -> list[DashboardRow]:
    """모든 페이지를 순회해 자산 행을 합쳐 돌려준다. 폐기 장비도 포함하고, 벤더 판정은 호출한 쪽이 한다."""
    base = (base_url or "").strip().rstrip("/")
    if not base.lower().startswith(("http://", "https://")):
        raise DashboardFetchError("대시보드 주소는 http:// 또는 https://로 시작해야 합니다.")

    rows: list[DashboardRow] = []
    received = 0
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=False, transport=transport) as client:
            for page in range(1, MAX_PAGES + 1):
                resp = await client.get(f"{base}/api/assets", params={"retired": 1, "page": page, "page_size": PAGE_SIZE})
                if resp.status_code != 200:
                    raise DashboardFetchError(f"대시보드가 오류로 응답했습니다 (HTTP {resp.status_code}).")
                received += len(resp.content)
                if received > MAX_RESPONSE_BYTES:
                    raise DashboardFetchError("대시보드 응답이 허용 크기를 넘었습니다.")
                try:
                    body = resp.json()
                except ValueError as e:
                    raise DashboardFetchError("대시보드 응답이 JSON이 아닙니다.") from e
                items = body.get("items") if isinstance(body, dict) else None
                if not isinstance(items, list):
                    raise DashboardFetchError("대시보드 응답 형식이 올바르지 않습니다 (items 없음).")
                rows.extend(_to_row(item) for item in items)
                total = body.get("total")
                if not items or (isinstance(total, int) and len(rows) >= total):
                    break
            else:
                raise DashboardFetchError("대시보드 페이지가 너무 많아 중단했습니다.")
    except httpx.HTTPError as e:
        raise DashboardFetchError(f"대시보드에 연결하지 못했습니다: {e.__class__.__name__}") from e

    if not rows:
        raise DashboardFetchError("대시보드에서 읽은 자산이 0건입니다.")
    return rows
