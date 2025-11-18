#!/usr/bin/env python
# -*- coding: utf-8 -*-

"""
신청 정보 파싱 기능을 제공하는 모듈
"""

import re
import logging
import pandas as pd
from datetime import datetime

logger = logging.getLogger(__name__)

class RequestParser:
    """신청 정보 파싱 기능을 제공하는 클래스"""
    
    def __init__(self, config_manager):
        """
        신청 정보 파서를 초기화합니다.
        
        Args:
            config_manager: 설정 관리자
        """
        self.config = config_manager
    
    def convert_to_date(self, date_str):
        """
        날짜 문자열을 날짜 형식으로 변환합니다.
        
        Args:
            date_str (str): 날짜 문자열
            
        Returns:
            str: 변환된 날짜 문자열
        """
        try:
            date_obj = datetime.strptime(date_str, '%Y%m%d')
            return date_obj.strftime('%Y-%m-%d')
        except ValueError:
            return date_str
    
    def parse_request_info(self, rulename, description):
        """
        규칙 이름과 설명에서 신청 정보를 파싱합니다.
        
        Args:
            rulename (str): 규칙 이름
            description (str): 설명
            
        Returns:
            dict: 파싱된 신청 정보
        """
        data_dict = {
            "Request Type": "Unknown",
            "Request ID": None,
            "Ruleset ID": None,
            "MIS ID": None,
            "Request User": None,
            "Start Date": self.convert_to_date('19000101'),
            "End Date": self.convert_to_date('19000101'),
        }
        
        if pd.isnull(description):
            return data_dict

        # 패턴 정의 (MIS ID가 optional)
        pattern_gsams_3 = re.compile(r"마스킹")
        pattern_gsams_1_rulename = re.compile(r'마스킹')
        pattern_gsams_1_user = r'마스킹'
        gsams_1_rulename = r"마스킹"
        gsams_1_date = r'마스킹'

        # 데이터 구조 검사 및 매칭 데이터 추출
        gsams3_match = pattern_gsams_3.match(description)
        gsams1_name_match = pattern_gsams_1_rulename.match(str(rulename))
        gsams1_user_match = re.search(pattern_gsams_1_user, description)
        gsams1_desc_match = re.search(gsams_1_rulename, description)
        gsams1_date_match = re.search(gsams_1_date, description)

        if gsams3_match:
            # 매칭된 데이터를 딕셔너리로 저장
            data_dict = {
                "Request Type": None,
                "Request ID": gsams3_match.group(5),
                "Ruleset ID": gsams3_match.group(1),
                "MIS ID": gsams3_match.group(6) if gsams3_match.group(6) else None,  # MIS ID가 없으면 None 할당
                "Request User": gsams3_match.group(4),
                "Start Date": self.convert_to_date(gsams3_match.group(2)),
                "End Date": self.convert_to_date(gsams3_match.group(3)),
            }
            
            # Request ID의 타입 분류
            type_code = data_dict["Request ID"][:1]  # 타입 코드 추출 (P, F, S)
            if type_code == "P":
                data_dict["Request Type"] = "GROUP"
            elif type_code == "F":
                data_dict["Request Type"] = "NORMAL"
            elif type_code == "S":
                data_dict["Request Type"] = "SERVER"
            elif type_code == "M":
                data_dict["Request Type"] = "PAM"
            else:
                data_dict["Request Type"] = "Unknown"
            
        if gsams1_name_match:
            data_dict['Request Type'] = "OLD"
            data_dict['Request ID'] = gsams1_name_match.group(1)
            if gsams1_user_match:
                data_dict['Request User'] = gsams1_user_match.group(1).replace("*ACL*", "")
            if gsams1_date_match:
                data_dict['Start Date'] = self.convert_to_date(gsams1_date_match.group().split("~")[0])
                data_dict['End Date'] = self.convert_to_date(gsams1_date_match.group().split("~")[1])
        
        if gsams1_desc_match:
            date = description.split(';')[0]
            start_date = date.split('~')[0].replace('[','').replace('-','')
            end_date = date.split('~')[1].replace(']','').replace('-','')

            data_dict = {
                "Request Type": "OLD",
                "Request ID": gsams1_desc_match.group(1).split('-')[1],
                "Ruleset ID": None,
                "MIS ID": None,
                "Request User": gsams1_user_match.group(1).replace("*ACL*", "") if gsams1_user_match else None,
                "Start Date": self.convert_to_date(start_date),
                "End Date": self.convert_to_date(end_date),
            }

        return data_dict
    
    def parse_request_type(self, file_manager):
        """
        파일에서 신청 유형을 파싱합니다.
        
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
            
            total = len(df)
            for index, row in df.iterrows():
                print(f"\r신청 정보 파싱 중: {index + 1}/{total}", end='', flush=True)
                result = self.parse_request_info(row['Rule Name'], row['Description'])
                for key, value in result.items():
                    df.at[index, key] = value
            
            print()  # 줄바꿈
            
            new_file_name = file_manager.update_version(file_name)
            df.to_excel(new_file_name, index=False)
            logger.info(f"신청 유형 파싱 결과를 '{new_file_name}'에 저장했습니다.")
            return True
        except Exception as e:
            logger.exception(f"신청 유형 파싱 중 오류 발생: {e}")
            return False 