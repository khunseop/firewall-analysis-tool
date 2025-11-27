"""
설정 파일 관리 모듈 (DB 기반)
"""
import json
import logging
from typing import Any, Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app import crud

logger = logging.getLogger(__name__)

CONFIG_KEY = "deletion_workflow_config"


class ConfigManager:
    """설정 관리 클래스 (DB 기반)"""
    
    def __init__(self, db: Optional[AsyncSession] = None):
        """
        ConfigManager 초기화
        
        Args:
            db: 데이터베이스 세션 (선택사항, 비동기 메서드 사용 시 필요)
        """
        self.db = db
        self.config_data: Optional[Dict[str, Any]] = None
        self._cache_valid = False
    
    async def _load_config(self, db: AsyncSession) -> Dict[str, Any]:
        """
        DB에서 설정 로드 (없으면 기본값으로 생성)
        
        Args:
            db: 데이터베이스 세션
            
        Returns:
            설정 딕셔너리
        """
        try:
            setting = await crud.settings.get_setting(db, CONFIG_KEY)
            if setting and setting.value:
                config_data = json.loads(setting.value)
                logger.debug(f"DB에서 설정 로드 완료: {CONFIG_KEY}")
                return config_data
        except Exception as e:
            logger.error(f"DB에서 설정 로드 실패: {CONFIG_KEY}, 오류: {e}")
        
        # DB에 설정이 없으면 기본값으로 생성
        logger.info(f"DB에 설정이 없습니다. 기본 설정으로 생성합니다: {CONFIG_KEY}")
        default_config = self._get_default_config()
        await self._save_config(db, default_config)
        return default_config
    
    async def _save_config(self, db: AsyncSession, config_data: Dict[str, Any]) -> None:
        """
        DB에 설정 저장
        
        Args:
            db: 데이터베이스 세션
            config_data: 저장할 설정 딕셔너리
        """
        try:
            from app.schemas.settings import SettingsCreate, SettingsUpdate
            
            setting = await crud.settings.get_setting(db, CONFIG_KEY)
            config_json = json.dumps(config_data, ensure_ascii=False, indent=2)
            
            if setting:
                # 업데이트
                setting_update = SettingsUpdate(
                    value=config_json,
                    description="정책 삭제 워크플로우 설정"
                )
                await crud.settings.update_setting(db, setting, setting_update)
            else:
                # 생성
                setting_create = SettingsCreate(
                    key=CONFIG_KEY,
                    value=config_json,
                    description="정책 삭제 워크플로우 설정"
                )
                await crud.settings.create_setting(db, setting_create)
            
            logger.info(f"DB에 설정 저장 완료: {CONFIG_KEY}")
            # 저장 후 캐시 업데이트
            self.config_data = config_data
            self._cache_valid = True
        except Exception as e:
            logger.error(f"DB에 설정 저장 실패: {CONFIG_KEY}, 오류: {e}")
            raise
    
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
    
    
    async def ensure_loaded(self, db: AsyncSession) -> None:
        """
        설정이 로드되었는지 확인하고, 없으면 로드
        
        Args:
            db: 데이터베이스 세션
        """
        if not self._cache_valid or self.config_data is None:
            self.config_data = await self._load_config(db)
            self._cache_valid = True
    
    
    async def set(self, db: AsyncSession, key: str, value: Any) -> None:
        """
        설정값 설정 (점으로 구분된 경로 지원)
        
        Args:
            db: 데이터베이스 세션
            key: 설정 키 (예: 'excel_styles.header_fill_color')
            value: 설정할 값
        """
        await self.ensure_loaded(db)
        
        keys = key.split('.')
        config = self.config_data
        
        # 중첩된 딕셔너리 생성
        for k in keys[:-1]:
            if k not in config:
                config[k] = {}
            config = config[k]
        
        # 값 설정
        config[keys[-1]] = value
        
        # DB에 저장
        await self._save_config(db, self.config_data)
        logger.info(f"설정 업데이트: {key} = {value}")
    
    async def all(self, db: AsyncSession) -> Dict[str, Any]:
        """
        모든 설정 반환
        
        Args:
            db: 데이터베이스 세션
            
        Returns:
            전체 설정 딕셔너리
        """
        await self.ensure_loaded(db)
        return self.config_data.copy()
    
    async def reload(self, db: AsyncSession) -> None:
        """
        설정 다시 로드
        
        Args:
            db: 데이터베이스 세션
        """
        self.config_data = await self._load_config(db)
        self._cache_valid = True
        logger.info("설정 다시 로드 완료")
    
    def get(self, key: str, default: Any = None, db: Optional[AsyncSession] = None) -> Any:
        """
        설정값 가져오기 (점으로 구분된 경로 지원)
        동기/비동기 모두 지원 (db가 None이면 동기 방식, 있으면 비동기 방식)
        
        Args:
            key: 설정 키 (예: 'excel_styles.header_fill_color')
            default: 기본값
            db: 데이터베이스 세션 (선택사항, 비동기 방식일 때만 필요)
            
        Returns:
            설정값 또는 기본값
        """
        # 동기 방식 (캐시된 데이터 사용)
        if db is None:
            if self.config_data is None:
                logger.warning("설정이 로드되지 않았습니다. 기본값을 사용합니다.")
                return default
            
            keys = key.split('.')
            value = self.config_data
            
            try:
                for k in keys:
                    value = value[k]
                return value
            except (KeyError, TypeError):
                logger.debug(f"설정 키 '{key}'를 찾을 수 없습니다. 기본값 '{default}'를 사용합니다.")
                return default
        else:
            # 비동기 방식 (나중에 async로 변경 필요)
            # 현재는 동기 방식으로 처리
            if self.config_data is None:
                logger.warning("설정이 로드되지 않았습니다. 기본값을 사용합니다.")
                return default
            
            keys = key.split('.')
            value = self.config_data
            
            try:
                for k in keys:
                    value = value[k]
                return value
            except (KeyError, TypeError):
                logger.debug(f"설정 키 '{key}'를 찾을 수 없습니다. 기본값 '{default}'를 사용합니다.")
                return default
    
    def get_sync(self, key: str, default: Any = None) -> Any:
        """
        동기 방식으로 설정값 가져오기 (캐시된 데이터 사용)
        주의: ensure_loaded가 먼저 호출되어야 함
        
        Args:
            key: 설정 키 (예: 'excel_styles.header_fill_color')
            default: 기본값
            
        Returns:
            설정값 또는 기본값
        """
        return self.get(key, default, db=None)
    
    def all_sync(self) -> Dict[str, Any]:
        """
        동기 방식으로 모든 설정 반환 (캐시된 데이터 사용)
        주의: ensure_loaded가 먼저 호출되어야 함
        
        Returns:
            전체 설정 딕셔너리
        """
        if self.config_data is None:
            logger.warning("설정이 로드되지 않았습니다. 기본 설정을 반환합니다.")
            return self._get_default_config()
        return self.config_data.copy()

