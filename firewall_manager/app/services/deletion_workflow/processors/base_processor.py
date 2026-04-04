# app/services/deletion_workflow/processors/base_processor.py

from abc import ABC, abstractmethod
import logging
from ..core.config_manager import ConfigManager
from ..utils.file_manager import FileManager


class BaseProcessor(ABC):
    """모든 정책 처리 프로세서의 베이스 클래스"""

    def __init__(self, config: ConfigManager):
        self.config = config
        self.logger = logging.getLogger(f"{self.__class__.__module__}.{self.__class__.__name__}")

    @abstractmethod
    def run(self, file_manager: FileManager, **kwargs) -> bool:
        """
        프로세서의 주 실행 로직을 구현합니다.

        Args:
            file_manager: 파일 관리자 인스턴스
            **kwargs: 추가 필요한 인자들

        Returns:
            bool: 성공 여부
        """
        pass
