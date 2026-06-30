"""
중복정책 미사용 예외를 정책 파일에 반영하는 모듈
fpat/processors/duplicate_exception_applier.py 이식 (YAML 인터랙티브 입력 제거)
YAML 파일은 external_1 슬롯으로 전달받음
"""
import logging
import yaml
import pandas as pd
from datetime import datetime
from .base_processor import BaseProcessor

logger = logging.getLogger(__name__)


class DuplicateExceptionApplier(BaseProcessor):
    """중복정책 미사용 예외를 자동으로 적용하는 클래스"""

    def run(self, file_manager, **kwargs):
        try:
            policy_file = file_manager.select_files()
            if not policy_file:
                return False

            df_policy = pd.read_excel(policy_file)

            yaml_file = file_manager.select_files()
            if not yaml_file:
                logger.warning("YAML 파일이 제공되지 않아 예외 반영 없이 통과합니다.")
                output_file = file_manager.update_version(policy_file, False)
                df_policy.to_excel(output_file, index=False, engine='openpyxl')
                return True

            with open(yaml_file, 'r', encoding='utf-8') as f:
                all_exceptions = yaml.safe_load(f) or {}

            if not all_exceptions:
                logger.info("YAML 파일에 기록된 예외 데이터가 없습니다.")
                output_file = file_manager.update_version(policy_file, False)
                df_policy.to_excel(output_file, index=False, engine='openpyxl')
                return True

            # 모든 방화벽 예외 통합 적용 (인터랙티브 방화벽명 선택 제거)
            current_date = self.config.get_reference_date()
            valid_names = []
            for fw_exceptions in all_exceptions.values():
                for item in fw_exceptions:
                    try:
                        expires_at    = datetime.strptime(item['expires_at'], '%Y-%m-%d').date()
                        registered_at = datetime.strptime(item['registered_at'], '%Y-%m-%d').date()
                    except (ValueError, KeyError) as e:
                        logger.warning(f"YAML 항목 날짜 파싱 실패 ({item.get('name', '?')}): {e}")
                        continue
                    if expires_at >= current_date and registered_at <= current_date:
                        valid_names.append(item['name'])

            if not valid_names:
                logger.info("유효기간 내 예외 정책이 없습니다.")
                output_file = file_manager.update_version(policy_file, False)
                df_policy.to_excel(output_file, index=False, engine='openpyxl')
                return True

            if '미사용여부' not in df_policy.columns:
                df_policy['미사용여부'] = ''

            mask = df_policy['Rule Name'].isin(valid_names)
            df_policy.loc[mask, '미사용여부'] = '중복정책_미사용예외'

            output_file = file_manager.update_version(policy_file, False)
            df_policy.to_excel(output_file, index=False, engine='openpyxl')

            logger.info(f"예외 반영 완료: {mask.sum()}건 → {output_file}")
            return True

        except Exception as e:
            logger.exception(f"중복정책 예외 반영 중 오류: {e}")
            return False
