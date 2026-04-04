# app/services/deletion_workflow/core/pipeline.py
"""
정책 삭제 프로세스용 파이프라인 엔진 및 태스크 레지스트리.
fpat/fpat/policy_deletion_processor/core/pipeline.py 이식.

TaskRegistry는 Tasks 4-6에서 프로세서가 추가될 때마다 채워집니다.
"""

import logging
from typing import List, Dict, Any, Optional

from ..processors.request_parser import RequestParser
from ..processors.request_extractor import RequestExtractor
from ..processors.mis_id_adder import MisIdAdder
from ..processors.application_aggregator import ApplicationAggregator
from ..processors.request_info_adder import RequestInfoAdder
from ..processors.exception_handler import ExceptionHandler
from ..processors.duplicate_policy_classifier import DuplicatePolicyClassifier
from ..processors.merge_hitcount import MergeHitcount
from ..processors.policy_usage_processor import PolicyUsageProcessor
from ..processors.notification_classifier import NotificationClassifier
from ..processors.auto_renewal_checker import AutoRenewalChecker

logger = logging.getLogger(__name__)


class TaskRegistry:
    """작업 번호와 프로세서 클래스를 매핑하는 레지스트리"""

    @staticmethod
    def get_processor_info(task_id: int) -> Optional[Dict[str, Any]]:
        """작업 번호에 해당하는 프로세서 클래스와 기본 인자를 반환합니다."""
        registry: Dict[int, Dict[str, Any]] = {
            # 2단계 이관 완료 (Task 4)
            1: {"class": RequestParser, "kwargs": {}},
            2: {"class": RequestExtractor, "kwargs": {}},
            3: {"class": MisIdAdder, "kwargs": {}},
            4: {"class": ApplicationAggregator, "kwargs": {}},
            5: {"class": RequestInfoAdder, "kwargs": {}},
            # 3단계 이관 완료 (Task 5)
            6: {"class": ExceptionHandler, "kwargs": {"vendor": "paloalto"}},
            7: {"class": ExceptionHandler, "kwargs": {"vendor": "secui"}},
            8: {"class": DuplicatePolicyClassifier, "kwargs": {"mode": "classify"}},
            9: {"class": DuplicatePolicyClassifier, "kwargs": {"mode": "update"}},
            10: {"class": MergeHitcount, "kwargs": {}},
            # 4단계 이관 완료 (Task 6)
            11: {"class": PolicyUsageProcessor, "kwargs": {"mode": "add"}},
            12: {"class": PolicyUsageProcessor, "kwargs": {"mode": "update"}},
            13: {"class": NotificationClassifier, "kwargs": {}},
            14: {"class": AutoRenewalChecker, "kwargs": {}},
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
        """실행할 단계를 추가합니다."""
        info = TaskRegistry.get_processor_info(task_id)
        if not info:
            logger.error(f"유효하지 않은 작업 번호: {task_id}")
            return

        processor_class = info["class"]
        kwargs = info["kwargs"].copy()
        kwargs.update(custom_kwargs)

        # NotificationClassifier는 excel_manager 주입 필요
        # (Task 6 이관 후 활성화)
        from ..processors.base_processor import BaseProcessor
        if hasattr(processor_class, '__name__') and processor_class.__name__ == 'NotificationClassifier':
            kwargs["excel_manager"] = self.excel_manager

        self.steps.append({
            "id": task_id,
            "processor": processor_class(self.config),
            "kwargs": kwargs,
        })

    def run(self) -> bool:
        """등록된 모든 단계를 순차적으로 실행합니다."""
        for step in self.steps:
            task_id = step["id"]
            processor = step["processor"]
            kwargs = step["kwargs"]

            logger.info(f"파이프라인 단계 시작: Task {task_id} ({processor.__class__.__name__})")

            if not processor.run(self.file_manager, **kwargs):
                logger.error(f"파이프라인 단계 실패: Task {task_id}")
                return False

            logger.info(f"파이프라인 단계 완료: Task {task_id}")

        return True
