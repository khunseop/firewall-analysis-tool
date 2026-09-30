"""한국 시간(KST) 관련 공유 유틸.

app/services/analysis/tasks.py, app/services/deletion_workflow/tasks.py,
app/api/api_v1/endpoints/deletion_workflow.py 세 곳에 동일 로직이
복붙되어 있던 것을 이 모듈로 통합했다.
"""
from datetime import datetime
from zoneinfo import ZoneInfo


def get_kst_now() -> datetime:
    """한국 시간(KST) 현재 시간을 naive datetime으로 반환한다."""
    return datetime.now(ZoneInfo("Asia/Seoul")).replace(tzinfo=None)
