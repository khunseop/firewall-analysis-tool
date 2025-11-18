"""
최종 결과 생성기 - 7개 엑셀 파일 생성
"""
import logging
from typing import Dict
import pandas as pd

from app.services.deletion_workflow.config_manager import ConfigManager
from app.services.deletion_workflow.file_manager import FileManager
from app.services.deletion_workflow.excel_manager import ExcelManager

logger = logging.getLogger(__name__)


class FinalExporter:
    """최종 결과 생성기"""
    
    def __init__(
        self,
        device_id: int,
        config_manager: ConfigManager,
        file_manager: FileManager,
        excel_manager: ExcelManager
    ):
        """
        FinalExporter 초기화
        
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
        self.columns = self.config.get('columns.all', [])
        self.columns_no_history = self.config.get('columns.no_history', [])
        self.date_columns = self.config.get('columns.date_columns', [])
        self.translated_columns = self.config.get('translated_columns', {})
    
    def export_final_results(self, master_file_path: str) -> Dict[str, str]:
        """
        최종 결과 파일들을 생성합니다.
        
        Args:
            master_file_path: 마스터 파일 경로 (Step 6 결과)
            
        Returns:
            생성된 파일 경로 딕셔너리
        """
        try:
            logger.info(f"최종 결과 생성 시작 (device_id={self.device_id})")
            
            df = pd.read_excel(master_file_path)
            
            result_files = {}
            
            # 1. 마스터 분석결과 파일
            master_result_path = self.file_manager.create_final_file_path(self.device_id, "마스터_분석결과")
            self.excel_manager.save_dataframe_to_excel(
                df=df,
                file_path=master_result_path,
                sheet_name="전체정책",
                index=False,
                style=True
            )
            result_files['master'] = master_result_path
            
            # 2-5. 공지용 파일들
            result_files.update(self._export_notice_files(df))
            
            logger.info(f"최종 결과 생성 완료: {len(result_files)}개 파일")
            return result_files
            
        except Exception as e:
            logger.error(f"최종 결과 생성 실패: {e}", exc_info=True)
            raise
    
    def _export_notice_files(self, df: pd.DataFrame) -> Dict[str, str]:
        """
        공지용 파일들을 생성합니다.
        
        Args:
            df: 마스터 DataFrame
            
        Returns:
            생성된 파일 경로 딕셔너리
        """
        result_files = {}
        
        # 2. 만료_사용정책
        expired_used = self._filter_expired_used(df)
        if not expired_used.empty:
            file_path = self.file_manager.create_final_file_path(self.device_id, "만료_사용정책")
            self._save_notice_file(expired_used, file_path, "만료_사용정책")
            result_files['expired_used'] = file_path
        
        # 3. 만료_미사용정책
        expired_unused = self._filter_expired_unused(df)
        if not expired_unused.empty:
            file_path = self.file_manager.create_final_file_path(self.device_id, "만료_미사용정책")
            self._save_notice_file(expired_unused, file_path, "만료_미사용정책")
            result_files['expired_unused'] = file_path
        
        # 4. 장기미사용정책
        longterm_unused = self._filter_longterm_unused(df)
        if not longterm_unused.empty:
            file_path = self.file_manager.create_final_file_path(self.device_id, "장기미사용정책")
            self._save_notice_file(longterm_unused, file_path, "장기미사용정책")
            result_files['longterm_unused'] = file_path
        
        # 5. 이력없는_미사용정책
        no_history_unused = self._filter_no_history_unused(df)
        if not no_history_unused.empty:
            file_path = self.file_manager.create_final_file_path(self.device_id, "이력없는_미사용정책")
            self._save_notice_file(no_history_unused, file_path, "이력없는_미사용정책", no_history=True)
            result_files['no_history_unused'] = file_path
        
        return result_files
    
    def _filter_expired_used(self, df: pd.DataFrame) -> pd.DataFrame:
        """만료된 사용 정책 필터링"""
        return df[
            ((df['예외'].isna()) | (df['예외'] == '신규정책')) &
            (df.get('중복여부', pd.Series()).isna()) &
            (df.get('신청이력', pd.Series()) != 'Unknown') &
            (df['만료여부'] == '만료') &
            (df.get('미사용여부', pd.Series()) == '사용')
        ]
    
    def _filter_expired_unused(self, df: pd.DataFrame) -> pd.DataFrame:
        """만료된 미사용 정책 필터링"""
        return df[
            ((df['예외'].isna()) | (df['예외'] == '신규정책')) &
            (df.get('중복여부', pd.Series()).isna()) &
            (df.get('신청이력', pd.Series()) != 'Unknown') &
            (df['만료여부'] == '만료') &
            (df.get('미사용여부', pd.Series()) == '미사용')
        ]
    
    def _filter_longterm_unused(self, df: pd.DataFrame) -> pd.DataFrame:
        """장기 미사용 정책 필터링"""
        return df[
            (df['예외'].isna()) &
            (df.get('중복여부', pd.Series()).isna()) &
            (df.get('신청이력', pd.Series()).isin(['GROUP', 'NORMAL'])) &
            (df['만료여부'] == '미만료') &
            (df.get('미사용여부', pd.Series()) == '미사용')
        ]
    
    def _filter_no_history_unused(self, df: pd.DataFrame) -> pd.DataFrame:
        """이력 없는 미사용 정책 필터링"""
        return df[
            (df['예외'].isna()) &
            (df.get('중복여부', pd.Series()).isna()) &
            (df.get('신청이력', pd.Series()) == 'Unknown') &
            (df.get('미사용여부', pd.Series()) == '미사용')
        ]
    
    def _save_notice_file(
        self,
        filtered_df: pd.DataFrame,
        file_path: str,
        sheet_name: str,
        no_history: bool = False
    ) -> None:
        """
        공지용 파일 저장
        
        Args:
            filtered_df: 필터링된 DataFrame
            file_path: 저장할 파일 경로
            sheet_name: 시트 이름
            no_history: 이력 없는 경우 여부
        """
        # 필요한 컬럼만 선택
        columns_to_use = self.columns_no_history if no_history else self.columns
        selected_df = filtered_df[[col for col in columns_to_use if col in filtered_df.columns]].copy()
        selected_df = selected_df.astype(str)
        
        # 날짜 컬럼 형식 변환
        for date_column in self.date_columns:
            if date_column in selected_df.columns:
                selected_df[date_column] = pd.to_datetime(selected_df[date_column], errors='coerce').dt.strftime('%Y-%m-%d')
        
        # 컬럼명 번역
        selected_df.rename(columns=self.translated_columns, inplace=True)
        
        # 빈 값 처리
        selected_df.fillna('', inplace=True)
        selected_df.replace('nan', '', inplace=True)
        
        # 파일 저장
        self.excel_manager.save_dataframe_to_excel(
            df=selected_df,
            file_path=file_path,
            sheet_name=sheet_name,
            index=False,
            style=True
        )

