"""
설정 파일 관리 모듈
"""
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


class ConfigManager:
    """설정 파일 관리 클래스"""
    
    def __init__(self, config_filename: str = "deletion_workflow_config.json"):
        """
        ConfigManager 초기화
        
        Args:
            config_filename: 설정 파일 이름
        """
        self.config_filename = config_filename
        self.config_path = self._get_config_path()
        self.config_data = self._load_config()
    
    def _get_base_dir(self) -> Path:
        """
        설정 파일이 위치할 기본 디렉토리 반환
        
        Returns:
            기본 디렉토리 Path 객체
        """
        # 프로젝트 루트 기준으로 config 디렉토리 설정
        project_root = Path(__file__).resolve().parents[3]
        config_dir = project_root / "firewall_manager" / "config"
        config_dir.mkdir(parents=True, exist_ok=True)
        return config_dir
    
    def _get_config_path(self) -> Path:
        """
        설정 파일 경로 반환
        
        Returns:
            설정 파일 Path 객체
        """
        return self._get_base_dir() / self.config_filename
    
    def _get_default_config(self) -> Dict[str, Any]:
        """
        기본 설정 반환
        
        Returns:
            기본 설정 딕셔너리
        """
        return {
            "file_naming": {
                "policy_version_format": "_v{version}",
                "final_version_suffix": "_vf",
                "request_id_prefix": "request_id_"
            },
            "file_extensions": {
                "excel": ".xlsx",
                "csv": ".csv"
            },
            "excel_styles": {
                "header_fill_color": "E0E0E0",
                "history_fill_color": "ccffff"
            },
            "columns": {
                "all": [
                    "예외", "만료여부", "신청이력", "Rule Name", "Enable", "Action",
                    "Source", "User", "Destination", "Service", "Application",
                    "Security Profile", "Category", "Description",
                    "Request Type", "Request ID", "Ruleset ID", "MIS ID", "Request User", "Start Date", "End Date"
                ],
                "no_history": [
                    "예외", "Rule Name", "Enable", "Action",
                    "Source", "User", "Destination", "Service", "Application",
                    "Security Profile", "Category", "Description"
                ],
                "date_columns": [
                    "REQUEST_START_DATE", "REQUEST_END_DATE", "Start Date", "End Date"
                ]
            },
            "translated_columns": {
                "Rule Name": "규칙명",
                "Enable": "활성화",
                "Action": "동작",
                "Source": "출발지",
                "User": "사용자",
                "Destination": "목적지",
                "Service": "서비스",
                "Application": "애플리케이션",
                "Security Profile": "보안 프로필",
                "Category": "카테고리",
                "Description": "설명"
            },
            "except_list": [],
            "timeframes": {
                "recent_policy_days": 90
            },
            "parsing_patterns": {
                "gsams3": {
                    "pattern": "",
                    "group_mapping": {
                        "ruleset_id": 1,
                        "start_date": 2,
                        "end_date": 3,
                        "request_user": 4,
                        "request_id": 5,
                        "mis_id": 6
                    },
                    "description": "GSAMS3 형식 패턴. 형식: 'RS : (Ruleset ID) (Start Date)~(End Date) (User) (Request ID) (MIS ID)'. 그룹 매핑: 1=Ruleset ID(S+8자리숫자+4자리문자), 2=Start Date(8자리숫자), 3=End Date(8자리숫자), 4=Request User, 5=Request ID(PS/F/S/M+숫자), 6=MIS ID(16자리, optional)"
                },
                "gsams1_rulename": {
                    "pattern": "",
                    "group_mapping": {
                        "request_id": 1
                    },
                    "description": "GSAMS1 규칙명 패턴. 그룹 매핑: 1=Request ID"
                },
                "gsams1_user": {
                    "pattern": "",
                    "group_mapping": {
                        "request_user": 1
                    },
                    "remove_prefix": "*ACL*",
                    "description": "GSAMS1 사용자 패턴. 그룹 매핑: 1=Request User (prefix '*ACL*' 제거)"
                },
                "gsams1_description": {
                    "pattern": "",
                    "group_mapping": {
                        "request_id": 1
                    },
                    "description": "GSAMS1 description 패턴. 그룹 매핑: 1=Request ID (split('-')[1] 사용)"
                },
                "gsams1_date": {
                    "pattern": "",
                    "group_mapping": {
                        "date_range": 0
                    },
                    "description": "GSAMS1 날짜 패턴. 전체 매칭에서 '~'로 분리하여 Start Date와 End Date 추출"
                },
                "request_type_mapping": {
                    "P": "GROUP",
                    "F": "GENERAL",
                    "S": "SERVER",
                    "M": "PAM",
                    "description": "Request ID 첫 글자에 따른 타입 매핑"
                }
            }
        }
    
    def _load_config(self) -> Dict[str, Any]:
        """
        설정 파일 로드 (없으면 기본값으로 생성)
        
        Returns:
            설정 딕셔너리
        """
        if not self.config_path.exists():
            logger.info(f"설정 파일이 없습니다. 기본 설정으로 생성합니다: {self.config_path}")
            default_config = self._get_default_config()
            self._save_config(default_config)
            return default_config
        
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config_data = json.load(f)
            logger.debug(f"설정 파일 로드 완료: {self.config_path}")
            return config_data
        except Exception as e:
            logger.error(f"설정 파일 로드 실패: {self.config_path}, 오류: {e}")
            logger.info("기본 설정을 사용합니다.")
            return self._get_default_config()
    
    def _save_config(self, config_data: Dict[str, Any]) -> None:
        """
        설정 파일 저장
        
        Args:
            config_data: 저장할 설정 딕셔너리
        """
        try:
            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, ensure_ascii=False, indent=2)
            logger.info(f"설정 파일 저장 완료: {self.config_path}")
        except Exception as e:
            logger.error(f"설정 파일 저장 실패: {self.config_path}, 오류: {e}")
            raise
    
    def get(self, key: str, default: Any = None) -> Any:
        """
        설정값 가져오기 (점으로 구분된 경로 지원)
        
        Args:
            key: 설정 키 (예: 'excel_styles.header_fill_color')
            default: 기본값
            
        Returns:
            설정값 또는 기본값
        """
        keys = key.split('.')
        value = self.config_data
        
        try:
            for k in keys:
                value = value[k]
            return value
        except (KeyError, TypeError):
            logger.debug(f"설정 키 '{key}'를 찾을 수 없습니다. 기본값 '{default}'를 사용합니다.")
            return default
    
    def set(self, key: str, value: Any) -> None:
        """
        설정값 설정 (점으로 구분된 경로 지원)
        
        Args:
            key: 설정 키 (예: 'excel_styles.header_fill_color')
            value: 설정할 값
        """
        keys = key.split('.')
        config = self.config_data
        
        # 중첩된 딕셔너리 생성
        for k in keys[:-1]:
            if k not in config:
                config[k] = {}
            config = config[k]
        
        # 값 설정
        config[keys[-1]] = value
        
        # 파일에 저장
        self._save_config(self.config_data)
        logger.info(f"설정 업데이트: {key} = {value}")
    
    def all(self) -> Dict[str, Any]:
        """
        모든 설정 반환
        
        Returns:
            전체 설정 딕셔너리
        """
        return self.config_data.copy()
    
    def reload(self) -> None:
        """
        설정 파일 다시 로드
        """
        self.config_data = self._load_config()
        logger.info("설정 파일 다시 로드 완료")

