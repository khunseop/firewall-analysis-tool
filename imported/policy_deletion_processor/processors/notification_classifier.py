#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
정리대상별 공지파일 분류 기능을 제공하는 모듈
"""

import logging
import pandas as pd
import os

logger = logging.getLogger(__name__)

class NotificationClassifier:
    """정리대상별 공지파일 분류 기능을 제공하는 클래스"""
    
    def __init__(self, config_manager):
        """
        공지파일 분류기를 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager
        self.columns = self.config.get('columns.all', [])
        self.columns_no_history = self.config.get('columns.no_history', [])
        self.date_columns = self.config.get('columns.date_columns', [])
        self.translated_columns = self.config.get('translated_columns', {})
    
    def _save_to_excel(self, df, sheet_type, file_name, excel_manager):
        """
        DataFrame을 Excel 파일에 저장합니다.
        
        Args:
            df: 저장할 DataFrame
            sheet_type: 시트 유형
            file_name: 파일 이름
            excel_manager: Excel 관리자
        """
        df.to_excel(file_name, index=False, na_rep='', sheet_name=sheet_type)
        excel_manager.save_to_excel(df, sheet_type, file_name)
    
    def classify_notifications(self, file_manager, excel_manager):
        """
        정리대상별 공지파일을 분류합니다.
        
        Args:
            file_manager: 파일 관리자
            excel_manager: Excel 관리자
            
        Returns:
            bool: 성공 여부
        """
        try:
            print("분류할 정책 파일을 선택하세요:")
            selected_file = file_manager.select_files()
            if not selected_file:
                return False
            
            logger.info("정책 분류 시작")
            df = pd.read_excel(selected_file)
            
            # 1. 만료된 사용 정책 분류
            try:
                self._expired_used(df, selected_file, file_manager, excel_manager)
                logger.info("기간만료 분류 완료")
            except Exception as e:
                logger.error(f"기간만료 분류 실패: {e}")
            
            # 2. 만료된 미사용 정책 분류
            try:
                self._expired_unused(df, selected_file, file_manager, excel_manager)
                logger.info("만료/미사용 분류 완료")
            except Exception as e:
                logger.error(f"만료/미사용 분류 실패: {e}")
            
            # 3. 장기 미사용 정책 분류
            try:
                self._longterm_unused_rules(df, selected_file, file_manager, excel_manager)
                logger.info("장기미사용 분류 완료")
            except Exception as e:
                logger.error(f"장기미사용 분류 실패: {e}")
            
            # 4. 이력 없는 미사용 정책 분류
            try:
                self._no_history_unused(df, selected_file, file_manager, excel_manager)
                logger.info("이력없는 미사용 분류 완료")
            except Exception as e:
                logger.error(f"이력없는 미사용 분류 실패: {e}")
            
            logger.info("정책 분류 완료")
            print("정책 분류가 완료되었습니다.")
            return True
        
        except Exception as e:
            logger.exception(f"정책 분류 중 오류 발생: {e}")
            return False
    
    def _expired_used(self, df, selected_file, file_manager, excel_manager):
        """
        만료된 사용 정책을 분류합니다.
        
        Args:
            df: 정책 DataFrame
            selected_file: 선택된 파일 이름
            file_manager: 파일 관리자
            excel_manager: Excel 관리자
        """
        # 만료된 사용 정책 필터링
        filtered_df = df[
            ((df['예외'].isna()) | (df['예외'] == '신규정책')) &
            (df['중복여부'].isna()) &
            (df['신청이력'] != 'Unknown') &
            (df['만료여부'] == '만료') &
            (df['미사용여부'] == '사용')
        ]
        
        if filtered_df.empty:
            logger.info("만료된 사용 정책이 없습니다.")
            return
        
        # 필요한 컬럼만 선택
        selected_df = filtered_df[self.columns].copy()
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
        sheet_type = '만료_사용정책'
        filename = f"{file_manager.remove_extension(selected_file)}_기간만료(공지용).xlsx"
        
        self._save_to_excel(selected_df, sheet_type, filename, excel_manager)
        logger.info(f"만료된 사용 정책을 '{filename}'에 저장했습니다.")
        print(f"만료된 사용 정책이 '{filename}'에 저장되었습니다.")
    
    def _expired_unused(self, df, selected_file, file_manager, excel_manager):
        """
        만료된 미사용 정책을 분류합니다.
        
        Args:
            df: 정책 DataFrame
            selected_file: 선택된 파일 이름
            file_manager: 파일 관리자
            excel_manager: Excel 관리자
        """
        # 만료된 미사용 정책 필터링
        filtered_df = df[
            ((df['예외'].isna()) | (df['예외'] == '신규정책')) &
            (df['중복여부'].isna()) &
            (df['신청이력'] != 'Unknown') &
            (df['만료여부'] == '만료') &
            (df['미사용여부'] == '미사용')
        ]
        
        if filtered_df.empty:
            logger.info("만료된 미사용 정책이 없습니다.")
            return
        
        # 필요한 컬럼만 선택
        selected_df = filtered_df[self.columns].copy()
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
        sheet_type = '만료_미사용정책'
        filename = f"{file_manager.remove_extension(selected_file)}_만료_미사용정책(공지용).xlsx"
        
        self._save_to_excel(selected_df, sheet_type, filename, excel_manager)
        logger.info(f"만료된 미사용 정책을 '{filename}'에 저장했습니다.")
        print(f"만료된 미사용 정책이 '{filename}'에 저장되었습니다.")
    
    def _longterm_unused_rules(self, df, selected_file, file_manager, excel_manager):
        """
        장기 미사용 정책을 분류합니다.
        
        Args:
            df: 정책 DataFrame
            selected_file: 선택된 파일 이름
            file_manager: 파일 관리자
            excel_manager: Excel 관리자
        """
        # 장기 미사용 정책 필터링
        filtered_df = df[
            (df['예외'].isna()) &
            (df['중복여부'].isna()) &
            (df['신청이력'].isin(['GROUP', 'NORMAL'])) &
            (df['만료여부'] == '미만료') &
            (df['미사용여부'] == '미사용')
        ]
        
        if filtered_df.empty:
            logger.info("장기 미사용 정책이 없습니다.")
            return
        
        # 필요한 컬럼만 선택
        selected_df = filtered_df[self.columns].copy()
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
        sheet_type = '미만료_미사용정책'
        filename = f"{file_manager.remove_extension(selected_file)}_장기미사용정책(공지용).xlsx"
        
        self._save_to_excel(selected_df, sheet_type, filename, excel_manager)
        logger.info(f"장기 미사용 정책을 '{filename}'에 저장했습니다.")
        print(f"장기 미사용 정책이 '{filename}'에 저장되었습니다.")
    
    def _no_history_unused(self, df, selected_file, file_manager, excel_manager):
        """
        이력 없는 미사용 정책을 분류합니다.
        
        Args:
            df: 정책 DataFrame
            selected_file: 선택된 파일 이름
            file_manager: 파일 관리자
            excel_manager: Excel 관리자
        """
        # 이력 없는 미사용 정책 필터링
        filtered_df = df[
            (df['예외'].isna()) &
            (df['중복여부'].isna()) &
            (df['신청이력'] == 'Unknown') &
            (df['미사용여부'] == '미사용')
        ]
        
        if filtered_df.empty:
            logger.info("이력 없는 미사용 정책이 없습니다.")
            return
        
        # 필요한 컬럼만 선택
        selected_df = filtered_df[self.columns_no_history].copy()
        selected_df = selected_df.astype(str)
        
        # 빈 값 처리
        selected_df.fillna('', inplace=True)
        selected_df.replace('nan', '', inplace=True)
        
        # 파일 저장
        sheet_type = '이력없음_미사용정책'
        filename = f"{file_manager.remove_extension(selected_file)}_이력없는_미사용정책.xlsx"
        
        self._save_to_excel(selected_df, sheet_type, filename, excel_manager)
        logger.info(f"이력 없는 미사용 정책을 '{filename}'에 저장했습니다.")
        print(f"이력 없는 미사용 정책이 '{filename}'에 저장되었습니다.") 