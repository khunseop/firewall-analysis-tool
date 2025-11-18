"""
Step 6: ExceptionHandler - 예외 정책 분류
"""
import logging
from datetime import datetime, timedelta
import pandas as pd

from app.services.deletion_workflow.config_manager import ConfigManager
from app.services.deletion_workflow.file_manager import FileManager
from app.services.deletion_workflow.excel_manager import ExcelManager

logger = logging.getLogger(__name__)


class ExceptionHandler:
    """예외처리 프로세서"""
    
    def __init__(
        self,
        device_id: int,
        config_manager: ConfigManager,
        file_manager: FileManager,
        excel_manager: ExcelManager
    ):
        """
        ExceptionHandler 초기화
        
        Args:
            device_id: 장비 ID
            config_manager: 설정 관리자
            file_manager: 파일 관리자
            excel_manager: Excel 관리자
        """
        self.device_id = device_id
        self.config = config_manager
        self.file_manager = file_manager
        self.excel_manager = excel_manager
        self.except_list = self.config.get('except_list', [])
    
    def _check_date(self, row: pd.Series) -> str:
        """
        날짜를 확인하여 만료 여부를 반환합니다.
        
        Args:
            row: 데이터 행
            
        Returns:
            만료 여부 ('미만료' 또는 '만료')
        """
        current_date = datetime.now().date()
        try:
            end_date = pd.to_datetime(row.get('REQUEST_END_DATE', row.get('End Date'))).date()
            return '미만료' if end_date >= current_date else '만료'
        except:
            return '만료'
    
    def classify_exceptions(self, master_file_path: str, vendor: str = "paloalto") -> str:
        """
        예외 정책을 분류합니다.
        
        Args:
            master_file_path: 마스터 파일 경로
            vendor: 벤더 타입 ("paloalto" 또는 "secui")
            
        Returns:
            업데이트된 파일 경로
        """
        try:
            logger.info(f"Step 6: 예외처리 시작 (device_id={self.device_id}, vendor={vendor})")
            
            df = pd.read_excel(master_file_path)
            
            current_date = datetime.now()
            three_months_ago = current_date - timedelta(
                days=self.config.get('timeframes.recent_policy_days', 90)
            )
            
            # 예외 컬럼 추가
            df["예외"] = ''
            
            # 1. except_list와 request id 일치 시 예외 신청정책으로 표시
            df['REQUEST_ID'] = df.get('REQUEST_ID', pd.Series(dtype=str)).fillna('')
            for id in self.except_list:
                df.loc[df['REQUEST_ID'].str.startswith(id, na=False), '예외'] = '예외신청정책'
            
            # 2. 신규정책 표시 (최근 3개월 이내)
            if vendor == "paloalto":
                df['날짜'] = df['Rule Name'].str.extract(r'(\d{8})', expand=False)
                df['날짜'] = pd.to_datetime(df['날짜'], format='%Y%m%d', errors='coerce')
                df.loc[(df['날짜'] >= three_months_ago) & (df['날짜'] <= current_date), '예외'] = '신규정책'
            else:  # secui
                df['Start Date'] = pd.to_datetime(df.get('Start Date', pd.Series()), errors='coerce')
                df.loc[(df['Start Date'] >= three_months_ago) & (df['Start Date'] <= current_date), '예외'] = '신규정책'
            
            # 3. 자동연장정책 표시
            df.loc[df.get('REQUEST_STATUS', pd.Series()) == 99, '예외'] = '자동연장정책'
            
            # 4. 인프라정책 표시
            if vendor == "paloalto":
                try:
                    deny_std_rule_index = df[df['Rule Name'] == 'deny-std'].index[0]
                    df.loc[df.index < deny_std_rule_index, '예외'] = '인프라정책'
                except (IndexError, KeyError):
                    logger.warning("deny-std 정책을 찾을 수 없습니다.")
            else:  # secui
                try:
                    deny_std_rule_index = df[df['Description'].str.contains('기준룰', na=False)].index[0]
                    df.loc[df.index < deny_std_rule_index, '예외'] = '인프라정책'
                except (IndexError, KeyError):
                    logger.warning("기준룰을 찾을 수 없습니다.")
            
            # 5. 비활성화정책 표시
            df.loc[df['Enable'] == 'N', '예외'] = '비활성화정책'
            
            # 6. 기준정책 표시
            if vendor == "paloalto":
                df.loc[(df['Rule Name'].str.endswith('_Rule', na=False)) & (df['Enable'] == 'N'), '예외'] = '기준정책'
            else:
                df.loc[(df['Description'].str.contains('기준룰', na=False)) & (df['Enable'] == 'N'), '예외'] = '기준정책'
            
            # 7. 차단정책 표시
            df.loc[df['Action'] == 'deny', '예외'] = '차단정책'
            
            # 예외 컬럼을 맨 앞으로 이동
            df['예외'].fillna('', inplace=True)
            cols = list(df.columns)
            cols = ['예외'] + [col for col in cols if col != '예외']
            df = df[cols]
            
            # 만료여부 추가
            df['만료여부'] = df.apply(self._check_date, axis=1)
            
            # 날짜 컬럼 삭제
            df.drop(columns=['날짜'], inplace=True, errors='ignore')
            
            # 컬럼명 변경
            if 'Request Type' in df.columns:
                df.rename(columns={'Request Type': '신청이력'}, inplace=True)
            
            # 불필요한 컬럼 삭제
            cols_to_drop = ['Request ID', 'Ruleset ID', 'MIS ID', 'Request User', 'Start Date', 'End Date']
            df.drop(columns=[col for col in cols_to_drop if col in df.columns], inplace=True, errors='ignore')
            
            # 컬럼 순서 조정
            cols = list(df.columns)
            if '만료여부' in cols:
                cols.insert(cols.index('예외') + 1, cols.pop(cols.index('만료여부')))
            if '신청이력' in cols:
                cols.insert(cols.index('예외') + 1, cols.pop(cols.index('신청이력')))
            df = df[cols]
            
            # 미사용여부 컬럼 추가
            if '미사용여부' not in cols:
                cols.insert(cols.index('만료여부') + 1, '미사용여부')
                df = df.reindex(columns=cols)
                df['미사용여부'] = ''
            
            # 파일 저장
            updated_file_path = self.file_manager.create_step_file_path(self.device_id, 6)
            self.excel_manager.save_dataframe_to_excel(
                df=df,
                file_path=updated_file_path,
                sheet_name="정책_예외처리",
                index=False,
                style=True
            )
            
            logger.info(f"Step 6 완료: 파일 저장됨 - {updated_file_path}")
            return updated_file_path
            
        except Exception as e:
            logger.error(f"Step 6 실패: {e}", exc_info=True)
            raise

