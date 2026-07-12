# app/services/deletion_workflow/processors/request_parser.py
"""
신청 정보 파싱 프로세서 (Task 1).
fpat/fpat/policy_deletion_processor/processors/request_parser.py 이식.
"""

import re
import logging
import pandas as pd
from datetime import datetime

from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class RequestParser(BaseProcessor):
    """신청 정보 파싱 기능을 제공하는 클래스"""

    def run(self, file_manager, **kwargs) -> bool:
        return self.parse_request_type(file_manager)

    def convert_to_date(self, date_str: str) -> str:
        try:
            return datetime.strptime(date_str, '%Y%m%d').strftime('%Y-%m-%d')
        except ValueError:
            return date_str

    def parse_request_info(self, rulename, description) -> dict:
        data_dict = {
            "Request Type": "Unknown",
            "Request ID": None,
            "Ruleset ID": None,
            "MIS ID": None,
            "Request User": None,
            "Start Date": self.convert_to_date('19000101'),
            "End Date": self.convert_to_date('19000101'),
        }

        try:
            if pd.isnull(description):
                return data_dict

            conf_prefix = 'policy_processing.request_parsing'
            p_gsams3    = self.config.get(f'{conf_prefix}.gsams_3_pattern', '')
            p_gsams1_rn = self.config.get(f'{conf_prefix}.gsams_1_rulename_pattern', '')
            p_gsams1_u  = self.config.get(f'{conf_prefix}.gsams_1_user_pattern', '')
            p_gsams1_d  = self.config.get(f'{conf_prefix}.gsams_1_desc_pattern', '')
            p_gsams1_dt = self.config.get(f'{conf_prefix}.gsams_1_date_pattern', '')

            # 빈 패턴이면 None으로 처리 (re.compile("") 은 모든 문자열에 매치되어 오동작)
            gsams3_match      = re.compile(p_gsams3).match(description)       if p_gsams3    else None
            gsams1_name_match = re.compile(p_gsams1_rn).match(str(rulename))  if p_gsams1_rn else None
            gsams1_user_match = re.search(p_gsams1_u, description)            if p_gsams1_u  else None
            gsams1_desc_match = re.search(p_gsams1_d, description)            if p_gsams1_d  else None
            gsams1_date_match = re.search(p_gsams1_dt, description)           if p_gsams1_dt else None

            if gsams3_match:
                request_id = gsams3_match.group(5)
                if "v" in request_id:
                    texts = request_id.split('-')
                    request_id = texts[0] + '-' + texts[1]

                data_dict = {
                    "Request Type": None,
                    "Request ID": request_id,
                    "Ruleset ID": gsams3_match.group(1),
                    "MIS ID": gsams3_match.group(6) if gsams3_match.group(6) else None,
                    "Request User": gsams3_match.group(4),
                    "Start Date": self.convert_to_date(gsams3_match.group(2)),
                    "End Date": self.convert_to_date(gsams3_match.group(3)),
                }
                type_code = data_dict["Request ID"][:1]
                data_dict["Request Type"] = {
                    "P": "GROUP", "F": "GENERAL", "S": "SERVER", "M": "PAM"
                }.get(type_code, "Unknown")

            if gsams1_name_match:
                data_dict['Request Type'] = "OLD"
                data_dict['Request ID'] = gsams1_name_match.group(1)
                if gsams1_user_match:
                    data_dict['Request User'] = gsams1_user_match.group(1).replace("*ACL*", "")
                if gsams1_date_match:
                    parts = gsams1_date_match.group().split("~")
                    data_dict['Start Date'] = self.convert_to_date(parts[0])
                    data_dict['End Date'] = self.convert_to_date(parts[1])

            if gsams1_desc_match:
                date = description.split(';')[0]
                start_date = date.split('~')[0].replace('[', '').replace('-', '')
                end_date = date.split('~')[1].replace(']', '').replace('-', '')
                data_dict = {
                    "Request Type": "OLD",
                    "Request ID": gsams1_desc_match.group(1).split('-')[1],
                    "Ruleset ID": None,
                    "MIS ID": None,
                    "Request User": gsams1_user_match.group(1).replace("*ACL*", "") if gsams1_user_match else None,
                    "Start Date": self.convert_to_date(start_date),
                    "End Date": self.convert_to_date(end_date),
                }

        except Exception as e:
            logger.warning(f"파싱 실패 ({rulename}): {e}")

        return data_dict

    def parse_request_type(self, file_manager) -> bool:
        try:
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
            print()

            def clean_illegal_chars(val):
                if isinstance(val, str):
                    return "".join(c for c in val if c.isprintable() or c in "\t\n\r")
                return val

            df = df.applymap(clean_illegal_chars)

            new_file_name = file_manager.update_version(file_name)
            df.to_excel(new_file_name, index=False)
            logger.info(f"신청 정보 파싱 완료: '{new_file_name}'")
            return True
        except Exception as e:
            logger.exception(f"신청 정보 파싱 중 오류: {e}")
            return False
