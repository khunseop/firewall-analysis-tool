# app/services/deletion_workflow/core/pipeline.py
"""
정책 삭제 프로세스용 파이프라인 엔진 및 태스크 레지스트리.
fpat pipeline.py 이식 — 태스크 ID가 fpat 원본과 동일합니다.

Task  1: RequestParser           — 정책 파일 신청정보 파싱
Task  2: RequestExtractor        — 신청번호 추출
Task  3: MisIdAdder              — MIS ID 매핑
Task  4: ApplicationAggregator   — 신청정보 가공 (GSAMS)
Task  5: RequestInfoAdder        — 신청정보 정책파일 매핑
Task  6: ExceptionHandler        — 예외처리 (PaloAlto)
Task  7: ExceptionHandler        — 예외처리 (SECUI/MF2)
Task  8: BottomLatestPolicyValidator — 하단 최신정책 검증
Task  9: DuplicatePolicyClassifier(classify) — 중복정책 분류
Task 10: DuplicatePolicyClassifier(update)   — 중복정책 상태 업데이트
Task 11: DuplicateExpiredCleaner — 중복 만료셋 예외처리
Task 12: MergeHitcount           — 히트카운트 병합
Task 13: PolicyUsageProcessor(add) — 사용이력 반영
Task 14: PolicyUsageProcessor(update) — 미사용 상태 업데이트
Task 15: AutoRenewalChecker      — 자동연장 탐지
Task 16: NotificationClassifier  — 통보대상 분류
Task 17: (FAT DB 중복분석 — WorkspaceRunner 외부에서 처리)
Task 18: DuplicateExceptionApplier — 중복 예외 반영
Task 19: RequestParser (2nd run) — 중복결과 파일 신청정보 파싱
"""

import logging
from typing import List, Dict, Any, Optional

from ..processors.request_parser import RequestParser
from ..processors.request_extractor import RequestExtractor
from ..processors.mis_id_adder import MisIdAdder
from ..processors.application_aggregator import ApplicationAggregator
from ..processors.request_info_adder import RequestInfoAdder
from ..processors.exception_handler import ExceptionHandler
from ..processors.bottom_latest_policy_validator import BottomLatestPolicyValidator
from ..processors.duplicate_policy_classifier import DuplicatePolicyClassifier
from ..processors.duplicate_expired_cleaner import DuplicateExpiredCleaner
from ..processors.duplicate_exception_applier import DuplicateExceptionApplier
from ..processors.merge_hitcount import MergeHitcount
from ..processors.policy_usage_processor import PolicyUsageProcessor
from ..processors.auto_renewal_checker import AutoRenewalChecker
from ..processors.notification_classifier import NotificationClassifier

logger = logging.getLogger(__name__)


class TaskRegistry:
    """태스크 번호와 프로세서 클래스를 매핑하는 레지스트리"""

    @staticmethod
    def get_processor_info(task_id: int) -> Optional[Dict[str, Any]]:
        registry: Dict[int, Dict[str, Any]] = {
            1:  {"class": RequestParser,                "kwargs": {}},
            2:  {"class": RequestExtractor,             "kwargs": {}},
            3:  {"class": MisIdAdder,                   "kwargs": {}},
            4:  {"class": ApplicationAggregator,        "kwargs": {}},
            5:  {"class": RequestInfoAdder,             "kwargs": {}},
            6:  {"class": ExceptionHandler,             "kwargs": {"vendor": "paloalto"}},
            7:  {"class": ExceptionHandler,             "kwargs": {"vendor": "secui"}},
            8:  {"class": BottomLatestPolicyValidator,  "kwargs": {}},
            9:  {"class": DuplicatePolicyClassifier,    "kwargs": {"mode": "classify"}},
            10: {"class": DuplicatePolicyClassifier,    "kwargs": {"mode": "update"}},
            11: {"class": DuplicateExpiredCleaner,      "kwargs": {}},
            12: {"class": MergeHitcount,                "kwargs": {}},
            13: {"class": PolicyUsageProcessor,         "kwargs": {"mode": "add"}},
            14: {"class": PolicyUsageProcessor,         "kwargs": {"mode": "update"}},
            15: {"class": AutoRenewalChecker,           "kwargs": {}},
            16: {"class": NotificationClassifier,       "kwargs": {}},
            18: {"class": DuplicateExceptionApplier,    "kwargs": {}},
            19: {"class": RequestParser,                "kwargs": {}},  # 중복결과 파일 신청정보 파싱
        }
        return registry.get(task_id)


class Pipeline:
    """여러 프로세서를 순차적으로 실행하는 엔진"""

    def __init__(self, config, file_manager, excel_manager=None):
        self.config = config
        self.file_manager = file_manager
        self.excel_manager = excel_manager
        self.steps: List[Dict[str, Any]] = []

    def add_step(self, task_id: int, **custom_kwargs):
        info = TaskRegistry.get_processor_info(task_id)
        if not info:
            logger.error(f"유효하지 않은 작업 번호: {task_id}")
            return

        processor_class = info["class"]
        kwargs = info["kwargs"].copy()
        kwargs.update(custom_kwargs)

        if processor_class.__name__ == 'NotificationClassifier':
            kwargs["excel_manager"] = self.excel_manager

        self.steps.append({
            "id": task_id,
            "processor": processor_class(self.config),
            "kwargs": kwargs,
        })

    def run(self) -> bool:
        for step in self.steps:
            task_id   = step["id"]
            processor = step["processor"]
            kwargs    = step["kwargs"]

            logger.info(f"파이프라인 단계 시작: Task {task_id} ({processor.__class__.__name__})")

            if not processor.run(self.file_manager, **kwargs):
                logger.error(f"파이프라인 단계 실패: Task {task_id}")
                return False

            logger.info(f"파이프라인 단계 완료: Task {task_id}")

        return True
