#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
신청 ID 추출 기능을 제공하는 모듈
"""

import logging
import pandas as pd

logger = logging.getLogger(__name__)

class RequestExtractor:
    """신청 ID 추출 기능을 제공하는 클래스"""
    
    def __init__(self, config_manager):
        """
        신청 ID 추출기를 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager
    
    def extract_request_id(self, file_manager):
        """
        파일에서 신청 ID를 추출합니다.
        
        Args:
            file_manager: 파일 관리자
            
        Returns:
            bool: 성공 여부
        """
        try:
            print("정책 파일을 선택하세요:")
            file_name = file_manager.select_files()
            if not file_name:
                return False
            
            df = pd.read_excel(file_name)
            
            # 'Unknown' 값을 제외하고 고유한 Request Type 값을 추출
            unique_types = df[df['Request Type'] != 'Unknown']['Request Type'].unique()
            
            # 고유한 Request Type 값을 최대 5개 선택
            selected_types = unique_types[:5]
            
            if len(selected_types) == 0:
                logger.warning("추출할 신청 유형이 없습니다.")
                return False
            
            # 선택된 Request Type에 해당하는 데이터 추출
            selected_data = df[df['Request Type'].isin(selected_types)]
            
            if len(selected_data) == 0:
                logger.warning("추출할 신청 ID가 없습니다.")
                return False
            
            # 각 Request Type별로 Request ID 값만 추출하여 중복 제거 후 Excel의 각 시트로 저장
            request_id_prefix = self.config.get('file_naming.request_id_prefix', 'request_id_')
            output_file = f"{request_id_prefix}{file_name}"
            
            with pd.ExcelWriter(output_file) as writer:
                for request_type, group in selected_data.groupby('Request Type'):
                    unique_ids = group[['Request ID']].drop_duplicates()
                    unique_ids.to_excel(writer, sheet_name=request_type, index=False)
                    logger.info(f"신청 유형 '{request_type}'에서 {len(unique_ids)}개의 신청 ID를 추출했습니다.")
            
            logger.info(f"신청 ID 추출 결과를 '{output_file}'에 저장했습니다.")
            print(f"신청 ID 추출 결과가 '{output_file}'에 저장되었습니다.")
            return True
        except Exception as e:
            logger.exception(f"신청 ID 추출 중 오류 발생: {e}")
            return False 