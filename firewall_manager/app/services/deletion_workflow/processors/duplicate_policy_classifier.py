"""
Step 7: DuplicatePolicyClassifier - 중복정책 분류 (공지용/삭제용)
"""
import logging
import pandas as pd

from app.services.deletion_workflow.config_manager import ConfigManager
from app.services.deletion_workflow.file_manager import FileManager
from app.services.deletion_workflow.excel_manager import ExcelManager

logger = logging.getLogger(__name__)


class DuplicatePolicyClassifier:
    """중복정책 분류 프로세서"""
    
    def __init__(
        self,
        device_id: int,
        config_manager: ConfigManager,
        file_manager: FileManager,
        excel_manager: ExcelManager
    ):
        """
        DuplicatePolicyClassifier 초기화
        
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
    
    def classify_duplicates(
        self,
        master_file_path: str,
        redundancy_result_file_path: str,
        info_file_path: str
    ) -> tuple[str, str]:
        """
        중복정책 분석 결과와 신청정보를 결합하여 분류합니다.
        
        Args:
            master_file_path: 마스터 파일 경로 (Step 6 결과)
            redundancy_result_file_path: 중복정책 분석 결과 파일 경로
            info_file_path: 신청정보 파일 경로 (Step 4 결과)
            
        Returns:
            (공지용 파일 경로, 삭제용 파일 경로) 튜플
        """
        try:
            logger.info(f"Step 7: 중복정책 분류 시작 (device_id={self.device_id})")
            
            # 파일 읽기
            df = pd.read_excel(master_file_path)
            duplicate_df = pd.read_excel(redundancy_result_file_path)
            info_df = pd.read_excel(info_file_path)
            
            # 자동 연장 ID 찾기
            auto_extension_id = self._find_auto_extension_id(info_df)
            
            # 자동연장 여부 표시
            duplicate_df['자동연장'] = duplicate_df.get('Request ID', pd.Series()).isin(auto_extension_id)
            
            # 늦은종료일 표시 (각 No 그룹에서 가장 늦은 종료일을 가진 행)
            if 'No' in duplicate_df.columns and 'End Date' in duplicate_df.columns:
                duplicate_df['늦은종료일'] = duplicate_df.groupby('No')['End Date'].transform(
                    lambda x: (x == x.max()) & (~x.duplicated(keep='first'))
                )
            else:
                duplicate_df['늦은종료일'] = False
            
            # 신청자 검증 (각 No 그룹의 신청자가 모두 동일한지)
            if 'No' in duplicate_df.columns and 'Request User' in duplicate_df.columns:
                duplicate_df['신청자검증'] = duplicate_df.groupby('No')['Request User'].transform(
                    lambda x: x.nunique() == 1
                )
            else:
                duplicate_df['신청자검증'] = True
            
            # 날짜 검증 대상 규칙 찾기
            target_rule_true = duplicate_df[
                (duplicate_df.get('Type', pd.Series()) == 'Upper') & 
                (duplicate_df['늦은종료일'] == True)
            ]['No'].unique()
            
            # 날짜 검증 표시
            duplicate_df['날짜검증'] = False
            duplicate_df.loc[duplicate_df['No'].isin(target_rule_true), '날짜검증'] = True
            
            # 작업구분 설정 (유지 또는 삭제)
            duplicate_df['작업구분'] = '유지'
            duplicate_df.loc[duplicate_df['늦은종료일'] == False, '작업구분'] = '삭제'
            
            # 공지여부 설정
            duplicate_df['공지여부'] = False
            duplicate_df.loc[duplicate_df['신청자검증'] == False, '공지여부'] = True
            
            # 미사용 예외 설정
            duplicate_df['미사용예외'] = False
            duplicate_df.loc[
                (duplicate_df['날짜검증'] == False) & 
                (duplicate_df['늦은종료일'] == True),
                '미사용예외'
            ] = True
            
            # 자동연장 그룹 정책 예외 처리
            extensioned_df = duplicate_df.groupby('No').filter(lambda x: x['자동연장'].any())
            extensioned_group = extensioned_df[extensioned_df.get('Request Type', pd.Series()) == 'GROUP']
            exception_target = extensioned_group.groupby('No').filter(
                lambda x: len(x.get('Request ID', pd.Series()).unique()) >= 2
            )
            exception_id = exception_target[
                (exception_target['자동연장'] == True) & 
                (exception_target['작업구분'] == '삭제')
            ]['No']
            
            # 예외 ID 제외
            duplicate_df = duplicate_df[~duplicate_df['No'].isin(exception_id)]
            
            # 자동연장 정책 중 삭제 대상 필터링
            filtered_no = duplicate_df.groupby('No').filter(
                lambda x: (x.get('Request Type', pd.Series()) != 'GROUP').any() and
                        (x['작업구분'] == '삭제').any() and
                        (x['자동연장'] == True).any()
            )['No'].unique()
            
            duplicate_df = duplicate_df[~duplicate_df['No'].isin(filtered_no)]
            
            # 모두 삭제 대상인 그룹 필터링
            filtered_no_2 = duplicate_df.groupby('No').filter(
                lambda x: (x['작업구분'] != '유지').all()
            )['No'].unique()
            
            duplicate_df = duplicate_df[~duplicate_df['No'].isin(filtered_no_2)]
            
            # 특정 타입 제외
            target_types = ["PAM", "SERVER", "Unknown"]
            target_nos = duplicate_df[duplicate_df.get('Request Type', pd.Series()).isin(target_types)]['No'].drop_duplicates()
            duplicate_df = duplicate_df[~duplicate_df['No'].isin(target_nos)]
            
            # 공지용과 삭제용으로 분리
            notice_df = duplicate_df[duplicate_df['공지여부'] == True].copy()
            delete_df = duplicate_df[duplicate_df['공지여부'] == False].copy()
            
            # 작업구분 컬럼을 맨 앞으로 이동
            for target_df in [notice_df, delete_df]:
                if '작업구분' in target_df.columns:
                    column_to_move = target_df.pop('작업구분')
                    target_df.insert(0, '작업구분', column_to_move)
            
            # 불필요한 컬럼 제거
            columns_to_drop = [
                'Request Type', 'Ruleset ID', 'MIS ID', 'Start Date', 'End Date',
                '늦은종료일', '신청자검증', '날짜검증', '공지여부', '미사용예외', '자동연장'
            ]
            notice_df.drop(columns=[col for col in columns_to_drop if col in notice_df.columns], inplace=True, errors='ignore')
            delete_df.drop(columns=[col for col in columns_to_drop if col in delete_df.columns], inplace=True, errors='ignore')
            
            # 파일 저장
            notice_file_path = self.file_manager.create_final_file_path(self.device_id, "중복정책_공지용")
            delete_file_path = self.file_manager.create_final_file_path(self.device_id, "중복정책_삭제용")
            
            self.excel_manager.save_dataframe_to_excel(
                df=notice_df,
                file_path=notice_file_path,
                sheet_name="중복정책_공지용",
                index=False,
                style=True
            )
            
            self.excel_manager.save_dataframe_to_excel(
                df=delete_df,
                file_path=delete_file_path,
                sheet_name="중복정책_삭제용",
                index=False,
                style=True
            )
            
            logger.info(f"Step 7 완료: 공지용 파일 - {notice_file_path}, 삭제용 파일 - {delete_file_path}")
            return notice_file_path, delete_file_path
            
        except Exception as e:
            logger.error(f"Step 7 실패: {e}", exc_info=True)
            raise
    
    def _find_auto_extension_id(self, info_df: pd.DataFrame) -> pd.Series:
        """자동 연장 ID를 찾습니다."""
        if 'REQUEST_STATUS' not in info_df.columns:
            return pd.Series(dtype=str)
        
        if not pd.api.types.is_numeric_dtype(info_df['REQUEST_STATUS']):
            try:
                info_df['REQUEST_STATUS'] = pd.to_numeric(info_df['REQUEST_STATUS'], errors='coerce')
            except Exception:
                return pd.Series(dtype=str)
        
        filtered_df = info_df[
            ((info_df['REQUEST_STATUS'] == 98) & info_df['REQUEST_ID'].str.startswith('PS', na=False)) |
            (info_df['REQUEST_STATUS'] == 99)
        ]['REQUEST_ID'].drop_duplicates()
        
        return filtered_df

