"""
Step 3: MisIdAdder - CSV 업로드로 MIS ID 업데이트
"""
import logging
from typing import Optional
import pandas as pd

from app.services.deletion_workflow.config_manager import ConfigManager
from app.services.deletion_workflow.file_manager import FileManager
from app.services.deletion_workflow.excel_manager import ExcelManager

logger = logging.getLogger(__name__)


class MisIdAdder:
    """MIS ID 추가 프로세서"""
    
    def __init__(
        self,
        device_id: int,
        config_manager: ConfigManager,
        file_manager: FileManager,
        excel_manager: ExcelManager
    ):
        """
        MisIdAdder 초기화
        
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
    
    def update_mis_id(self, master_file_path: str, csv_file_path: str) -> str:
        """
        CSV 파일에서 MIS ID를 읽어서 마스터 파일을 업데이트합니다.
        
        Args:
            master_file_path: 마스터 파일 경로 (Step 1 결과)
            csv_file_path: MIS ID 매핑 CSV 파일 경로
            
        Returns:
            업데이트된 파일 경로
        """
        try:
            logger.info(f"Step 3: MIS ID 업데이트 시작 (device_id={self.device_id})")
            
            # 마스터 파일 읽기
            rule_df = pd.read_excel(master_file_path)
            
            # CSV 파일 읽기
            mis_df = pd.read_csv(csv_file_path)
            
            # 중복 제거
            mis_df_unique = mis_df.drop_duplicates(subset=['ruleset_id'], keep='first')
            
            # MIS ID 매핑 생성
            if 'ruleset_id' not in mis_df_unique.columns or 'mis_id' not in mis_df_unique.columns:
                raise ValueError("CSV 파일에 'ruleset_id' 또는 'mis_id' 컬럼이 없습니다.")
            
            mis_id_map = mis_df_unique.set_index('ruleset_id')['mis_id'].to_dict()
            
            # MIS ID 업데이트
            updated_count = 0
            total = len(rule_df)
            
            for idx, row in rule_df.iterrows():
                ruleset_id = row.get('Ruleset ID')
                current_mis_id = row.get('MIS ID')
                
                if (pd.isna(current_mis_id) or current_mis_id == '') and ruleset_id in mis_id_map:
                    rule_df.at[idx, 'MIS ID'] = mis_id_map.get(ruleset_id)
                    updated_count += 1
            
            # 업데이트된 파일 저장
            updated_file_path = self.file_manager.create_step_file_path(self.device_id, 3)
            self.excel_manager.save_dataframe_to_excel(
                df=rule_df,
                file_path=updated_file_path,
                sheet_name="정책_신청정보",
                index=False,
                style=True
            )
            
            logger.info(f"{updated_count}개의 정책에 MIS ID를 추가했습니다.")
            logger.info(f"Step 3 완료: 파일 저장됨 - {updated_file_path}")
            return updated_file_path
            
        except Exception as e:
            logger.error(f"Step 3 실패: {e}", exc_info=True)
            raise

