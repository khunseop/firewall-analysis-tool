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
    
    def _migrate_config(self, config_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        기존 설정을 새 형식으로 마이그레이션 (불필요한 항목 제거)
        
        Args:
            config_data: 기존 설정 딕셔너리
            
        Returns:
            마이그레이션된 설정 딕셔너리
        """
        # 기본 설정 가져오기
        migrated = self._get_default_config()
        
        # 기존 설정에서 필요한 항목만 복사
        if 'except_list' in config_data:
            migrated['except_list'] = config_data['except_list']
        
        if 'timeframes' in config_data and 'recent_policy_days' in config_data.get('timeframes', {}):
            migrated['timeframes']['recent_policy_days'] = config_data['timeframes']['recent_policy_days']
        
        if 'parsing_patterns' in config_data:
            # 모든 파싱 패턴 복사 (동적 추가/삭제 지원)
            patterns = config_data['parsing_patterns']
            migrated['parsing_patterns'] = patterns.copy()
        
        if 'application_info_column_mapping' in config_data:
            migrated['application_info_column_mapping'] = config_data['application_info_column_mapping']
        
        # columns와 translated_columns는 코드에서 하드코딩되어 있으므로 유지
        if 'columns' in config_data:
            migrated['columns'] = config_data['columns']
        if 'translated_columns' in config_data:
            migrated['translated_columns'] = config_data['translated_columns']
        
        return migrated
    
    async def _load_config(self, db: AsyncSession) -> Dict[str, Any]:
        """
        DB에서 설정 로드 (없으면 기본값으로 생성)
        기존 설정이 있으면 마이그레이션 수행
        
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
                
                # 마이그레이션 수행 (불필요한 항목 제거)
                migrated_config = self._migrate_config(config_data)
                
                # 마이그레이션된 설정이 기존과 다르면 저장
                if migrated_config != config_data:
                    logger.info(f"설정 마이그레이션 수행: 불필요한 항목 제거")
                    await self._save_config(db, migrated_config)
                    return migrated_config
                
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
        기본 설정 반환 (정리된 버전 - 불필요한 항목 제거)
        
        Returns:
            기본 설정 딕셔너리
        """
        return {
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
                "request_type_mapping": {
                    "P": "GROUP",
                    "F": "GENERAL",
                    "S": "SERVER",
                    "M": "PAM",
                    "description": "Request ID 첫 글자에 따른 타입 매핑"
                }
            },
            "application_info_column_mapping": {
                "REQUEST_ID": ["REQUEST_ID", "Request ID", "요청ID", "신청ID"],
                "REQUEST_START_DATE": ["REQUEST_START_DATE", "Request Start Date", "시작일", "신청시작일"],
                "REQUEST_END_DATE": ["REQUEST_END_DATE", "Request End Date", "종료일", "신청종료일"],
                "TITLE": ["TITLE", "Title", "제목", "신청제목"],
                "REQUESTER_ID": ["REQUESTER_ID", "Requester ID", "신청자ID", "요청자ID"],
                "REQUESTER_EMAIL": ["REQUESTER_EMAIL", "Requester Email", "신청자이메일", "요청자이메일"],
                "REQUESTER_NAME": ["REQUESTER_NAME", "Requester Name", "신청자명", "요청자명"],
                "REQUESTER_DEPT": ["REQUESTER_DEPT", "Requester Dept", "신청자부서", "요청자부서"],
                "WRITE_PERSON_ID": ["WRITE_PERSON_ID", "Write Person ID", "작성자ID"],
                "WRITE_PERSON_EMAIL": ["WRITE_PERSON_EMAIL", "Write Person Email", "작성자이메일"],
                "WRITE_PERSON_NAME": ["WRITE_PERSON_NAME", "Write Person Name", "작성자명"],
                "WRITE_PERSON_DEPT": ["WRITE_PERSON_DEPT", "Write Person Dept", "작성자부서"],
                "APPROVAL_PERSON_ID": ["APPROVAL_PERSON_ID", "Approval Person ID", "승인자ID"],
                "APPROVAL_PERSON_EMAIL": ["APPROVAL_PERSON_EMAIL", "Approval Person Email", "승인자이메일"],
                "APPROVAL_PERSON_NAME": ["APPROVAL_PERSON_NAME", "Approval Person Name", "승인자명"],
                "APPROVAL_PERSON_DEPT_NAME": ["APPROVAL_PERSON_DEPT_NAME", "Approval Person Dept Name", "승인자부서명"],
                "REQUEST_DATE": ["REQUEST_DATE", "Request Date", "신청일", "요청일"],
                "REQUEST_STATUS": ["REQUEST_STATUS", "Request Status", "신청상태", "요청상태"],
                "PROGRESS": ["PROGRESS", "Progress", "진행상태"],
                "MIS_ID": ["MIS_ID", "MIS ID", "MISID"],
                "GROUP_VERSION": ["GROUP_VERSION", "Group Version", "그룹버전", "버전"]
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

