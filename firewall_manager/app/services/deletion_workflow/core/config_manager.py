# app/services/deletion_workflow/core/config_manager.py
"""
fpat.yaml 기반 설정 관리자.
fpat/fpat/policy_deletion_processor/core/config_manager.py 이식.
"""

import json
import logging
import os
import re
from datetime import datetime
from typing import Any, Dict, Optional

try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False

logger = logging.getLogger(__name__)


class ConfigManager:
    """fpat.yaml 기반 삭제 워크플로 설정 관리자"""

    def __init__(self, config_path: Optional[str] = None) -> None:
        """
        설정 관리자를 초기화합니다.

        탐색 순서:
        1. config_path (명시적 경로)
        2. FPAT_CONFIG 환경 변수
        3. 현재 작업 디렉토리의 fpat.yaml / fpat.yml / config.json
        4. 이 모듈 기준 상위 디렉토리의 fpat.yaml
        """
        self.config_path = self._find_config(config_path)
        self.config_data = self._load_config()
        logger.info(f"설정 파일 로드: {self.config_path}")

    def _find_config(self, explicit_path: Optional[str]) -> str:
        search_paths = []

        if explicit_path:
            search_paths.append(explicit_path)

        env_path = os.environ.get('FPAT_CONFIG')
        if env_path:
            search_paths.append(env_path)

        cwd = os.getcwd()
        # 프로젝트 루트 (firewall_manager 상위) 도 탐색
        module_dir = os.path.dirname(os.path.abspath(__file__))
        project_root = os.path.abspath(os.path.join(module_dir, '..', '..', '..', '..', '..', '..'))

        for base in [cwd, project_root]:
            search_paths.append(os.path.join(base, 'fpat.yaml'))
            search_paths.append(os.path.join(base, 'fpat.yml'))
            search_paths.append(os.path.join(base, 'config.json'))

        for path in search_paths:
            if os.path.exists(path) and os.path.isfile(path):
                return os.path.abspath(path)

        return os.path.abspath(os.path.join(cwd, 'fpat.yaml'))

    def _load_config(self) -> Dict[str, Any]:
        if not os.path.exists(self.config_path):
            logger.warning(f"설정 파일을 찾을 수 없습니다: {self.config_path}. 기본값으로 실행합니다.")
            return {}

        try:
            _, ext = os.path.splitext(self.config_path)
            ext = ext.lower()

            if ext in ['.yaml', '.yml']:
                if not HAS_YAML:
                    raise ImportError("YAML 파일 로드에 'PyYAML' 라이브러리가 필요합니다.")
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    return yaml.safe_load(f) or {}
            else:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    return json.load(f) or {}
        except Exception as e:
            logger.error(f"설정 파일 로드 실패 ({self.config_path}): {e}")
            return {}

    def get(self, key: str, default: Any = None) -> Any:
        """
        계층적 키로 설정값을 조회합니다.
        예: config.get('exceptions.request_ids')
        """
        keys = key.split('.')
        value = self.config_data
        try:
            for k in keys:
                if isinstance(value, dict):
                    value = value[k]
                else:
                    raise KeyError
            return value
        except (KeyError, TypeError):
            return default

    def is_excepted(self, category: str, value: str) -> bool:
        """
        특정 항목이 예외 대상인지 확인합니다 (기간 만료 체크 포함).

        Args:
            category: 'request_ids' 또는 'policy_rules'
            value: 체크할 ID 또는 규칙명

        Returns:
            bool: 예외 대상 여부
        """
        exceptions = self.get(f'exceptions.{category}', [])
        current_date = datetime.now().date()

        for item in exceptions:
            match = False
            if category == 'request_ids':
                if value == item.get('id', ''):
                    match = True
            elif category == 'policy_rules':
                pattern = item.get('pattern', '')
                if re.match(pattern, value):
                    match = True

            if match:
                until_str = item.get('until')
                if not until_str:
                    return True  # 영구 예외
                try:
                    until_date = datetime.strptime(until_str, '%Y-%m-%d').date()
                    if until_date >= current_date:
                        return True
                    logger.debug(f"예외 기간 만료: {value} (until: {until_str})")
                except ValueError:
                    logger.warning(f"잘못된 날짜 형식 (until): {until_str}")
                    return True  # 형식 오류 시 안전하게 예외 유지

        static_list = self.get('exceptions.static_list', [])
        if value in static_list:
            return True

        return False

    def all(self) -> Dict[str, Any]:
        return self.config_data
